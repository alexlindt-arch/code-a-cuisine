/**
 * @file preferences-quota.service.ts
 * @description Quota state of the preferences page: server quota, local usage, dialog and summary text.
 */
import { Injectable, inject, signal } from '@angular/core';
import { I18nService } from '../i18n/i18n.service';
import type { QuotaStatus } from './preferences.models';
import { LocalQuotaService } from './local-quota.service';
import type { RequestDialogKind } from './recipe-request.service';

/** Remaining generations for the current IP and (when known) for the whole app. */
export interface QuotaRemainingSummary {
  perIpRemaining: number;
  perIpLimit: number;
  globalRemaining: number | null;
  globalLimit: number | null;
}

/** Time zone in which the server counts its calendar-day quota. */
const SERVER_TIME_ZONE = 'Europe/Berlin';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Formats a date as calendar day ('YYYY-MM-DD') in the server time zone.
 * @param date - Date to format (defaults to now).
 * @returns The calendar day key.
 */
export function toServerDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SERVER_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * Returns the time until the next midnight in the server time zone.
 * @param referenceMs - Reference time in milliseconds (defaults to now).
 * @returns Milliseconds until the server quota resets.
 */
export function msUntilServerMidnight(referenceMs = Date.now()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SERVER_TIME_ZONE, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(referenceMs));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value ?? 0);
  const elapsedMs = ((part('hour') * 60 + part('minute')) * 60 + part('second')) * 1000 + (referenceMs % 1000);
  return Math.max(0, DAY_MS - elapsedMs);
}

/**
 * Holds the quota state of the preferences page and combines local usage with the last server quota.
 */
@Injectable({ providedIn: 'root' })
export class PreferencesQuotaService {
  private readonly localQuota = inject(LocalQuotaService);
  protected readonly i18n = inject(I18nService);
  private readonly serverQuotaKey = 'cac-last-server-quota';

  readonly status = signal<QuotaStatus | null>(null);
  readonly message = signal<string | null>(null);
  readonly details = signal<string[]>([]);
  readonly exceeded = signal(false);
  readonly dialogVisible = signal(false);
  readonly dialogKind = signal<RequestDialogKind>('notice');
  readonly loading = signal(true);

  /**
   * Synchronizes the local quota config and restores today's last known server quota.
   */
  initialize(): void {
    this.localQuota.ensureConfig();
    const storedQuota = this.readStoredServerQuota();
    if (this.isForToday(storedQuota)) {
      this.status.set(storedQuota);
    }
  }

  /**
   * Marks whether the initial quota check is still running.
   * @param value - True while loading.
   */
  setLoading(value: boolean): void {
    this.loading.set(value);
  }

  /**
   * Returns the local per-IP daily limit.
   * @returns The limit.
   */
  getLimit(): number {
    return this.localQuota.getLimit();
  }

  /**
   * Returns today's local usage of an IP.
   * @param ip - Client IP address.
   * @param referenceMs - Reference time in milliseconds (defaults to now).
   * @returns Number of generations used today.
   */
  getUsage(ip: string, referenceMs = Date.now()): number {
    return this.localQuota.getUsage(ip, referenceMs);
  }

  /**
   * Records one successful generation locally.
   * @param ip - Client IP address.
   * @param referenceMs - Time of the generation (defaults to now).
   */
  increment(ip: string, referenceMs = Date.now()): void {
    this.localQuota.increment(ip, referenceMs);
  }

  /**
   * Returns the time until the used-up quota resets (local or server calendar day).
   * @param ip - Client IP address.
   * @param referenceMs - Reference time in milliseconds (defaults to now).
   * @returns Milliseconds until reset, or 0 when no limit is reached.
   */
  getResetMs(ip: string, referenceMs = Date.now()): number {
    const localResetMs = this.localQuota.getTimeUntilReset(ip, referenceMs);
    const serverResetMs = this.isServerQuotaUsedUp(this.status()) ? msUntilServerMidnight(referenceMs) : 0;
    return Math.max(localResetMs, serverResetMs);
  }

  /**
   * Drops usage and server quota of previous days and clears the limit state when it no longer applies.
   * @param ip - Client IP address.
   * @param referenceMs - Reference time in milliseconds (defaults to now).
   */
  clearExpired(ip: string, referenceMs = Date.now()): void {
    this.localQuota.clearExpiredLock(ip, referenceMs);
    if (this.status() && !this.isForToday(this.status())) {
      this.status.set(null);
    }

    const stillReached = this.hasReached(this.status(), this.getUsage(ip, referenceMs));
    this.exceeded.set(stillReached);
    if (!stillReached && this.dialogKind() === 'limit') {
      this.message.set(null);
    }
  }

  /**
   * Checks whether a quota belongs to the current server calendar day.
   * @param quota - Quota status with a 'YYYY-MM-DD' date (ISO timestamps are accepted too).
   * @returns True when the quota is from today.
   */
  isForToday(quota: QuotaStatus | null): quota is QuotaStatus {
    return !!quota && typeof quota.date === 'string' && quota.date.slice(0, 10) === toServerDateKey();
  }

  /**
   * Checks whether no further generation is possible today.
   * @param quota - Last known server quota.
   * @param localUsage - Today's local usage.
   * @returns True when the local limit or a server limit is used up.
   */
  hasReached(quota: QuotaStatus | null, localUsage: number): boolean {
    return localUsage >= this.getLimit() || (this.isForToday(quota) && this.isServerQuotaUsedUp(quota));
  }

  /**
   * Stores a quota reported by the server and updates the limit state.
   * @param quota - Quota from a webhook response.
   */
  sync(quota: QuotaStatus): void {
    this.status.set(quota);
    this.exceeded.set(this.isServerQuotaUsedUp(quota));
    try {
      localStorage.setItem(this.serverQuotaKey, JSON.stringify(quota));
    } catch (error) {
      console.error('Unable to persist server quota:', error);
    }
  }

  /**
   * Combines local usage and today's server quota into remaining generations.
   * @param ip - Client IP address.
   * @returns Remaining generations for the IP and, when known, for the app.
   */
  buildRemainingSummary(ip: string): QuotaRemainingSummary {
    const quota = this.status();
    const serverQuota = this.isForToday(quota) ? quota : null;
    const perIpLimit = serverQuota?.perIpLimit ?? this.getLimit();
    const used = Math.max(this.getUsage(ip), serverQuota?.perIpUsed ?? 0);
    const serverRemaining = serverQuota?.perIpRemaining ?? Number.POSITIVE_INFINITY;

    return {
      perIpRemaining: Math.max(0, Math.min(perIpLimit - used, serverRemaining)),
      perIpLimit,
      globalRemaining: serverQuota ? Math.max(0, serverQuota.globalRemaining) : null,
      globalLimit: serverQuota?.globalLimit ?? null,
    };
  }

  /**
   * Builds the quota line shown on the preferences page.
   * @param ip - Client IP address.
   * @returns For example "2 of 3 left today for your IP · 9 of 12 left in the app today".
   */
  buildSummaryText(ip: string): string {
    const summary = this.buildRemainingSummary(ip);
    const ipText = this.i18n.t('quota.summaryIp', { remaining: summary.perIpRemaining, limit: summary.perIpLimit });
    if (summary.globalRemaining === null || summary.globalLimit === null) {
      return ipText;
    }
    return `${ipText} · ${this.i18n.t('quota.summaryGlobal', { remaining: summary.globalRemaining, limit: summary.globalLimit })}`;
  }

  /**
   * Builds the fallback message for a reached daily limit when the server sent no message.
   * @param usage - Today's local usage.
   * @param quota - Last known server quota.
   * @returns The limit message.
   */
  buildDailyMessage(usage: number, quota: QuotaStatus | null = this.status()): string {
    if (quota && quota.globalRemaining <= 0 && quota.perIpRemaining > 0) {
      return this.i18n.t('quota.globalUsedUp', { limit: quota.globalLimit });
    }
    const used = Math.max(usage, quota?.perIpUsed ?? 0);
    const limit = quota?.perIpLimit ?? this.getLimit();
    return this.i18n.t('quota.dailyReached', { used: Math.min(used, limit), limit });
  }

  /**
   * Checks whether the per-IP or the global server quota is used up.
   * @param quota - Server quota.
   * @returns True when no generations remain.
   */
  private isServerQuotaUsedUp(quota: QuotaStatus | null): boolean {
    return !!quota && (quota.perIpRemaining <= 0 || quota.globalRemaining <= 0);
  }

  /**
   * Reads the last server quota from localStorage.
   * @returns The stored quota, or null when missing or invalid.
   */
  private readStoredServerQuota(): QuotaStatus | null {
    try {
      const parsed = JSON.parse(localStorage.getItem(this.serverQuotaKey) ?? 'null') as QuotaStatus | null;
      return parsed && typeof parsed.date === 'string' && typeof parsed.perIpRemaining === 'number'
        && typeof parsed.globalRemaining === 'number' ? parsed : null;
    } catch {
      return null;
    }
  }
}
