/**
 * @file recipe-request.service.ts
 * @description Sends recipe requests to the n8n webhook and interprets its error responses.
 */
import { Injectable, inject } from '@angular/core';
import { I18nService } from '../i18n/i18n.service';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { environment } from '../../environments/environment';
import type { QuotaStatus, RecipeRequestPayload } from './preferences.models';

/** Kind of dialog shown after a failed request; decides title and actions. */
export type RequestDialogKind = 'notice' | 'limit' | 'throttle' | 'invalid' | 'blocked' | 'failed' | 'connection';

/** Error details extracted from a failed webhook request. */
export interface ApiErrorDetails {
  status: number | null;
  code: string | null;
  message: string | null;
  errors: string[];
  quota: QuotaStatus | null;
}

/**
 * Longest wait for an answer: the workflow allows two AI attempts of up to 120s each, so a
 * request still pending after three minutes is treated as failed instead of spinning forever.
 */
const REQUEST_TIMEOUT_MS = 180_000;

/**
 * Posts recipe requests to the n8n webhook and maps its error responses to messages and dialog kinds.
 */
@Injectable({ providedIn: 'root' })
export class RecipeRequestService {
  private readonly http = inject(HttpClient);
  protected readonly i18n = inject(I18nService);
  private readonly webhookPath = environment.recipeWebhookUrl;

  /**
   * Returns the configured recipe webhook URLs that pass validation.
   * @returns Unique, valid webhook URLs.
   */
  getWebhookUrls(): string[] {
    return Array.from(new Set([`${this.webhookPath}code-a-cuisine-recipe`]))
      .filter((url) => this.isValidWebhookUrl(url));
  }

  /**
   * Posts the payload to each URL until one succeeds.
   * @param payload - Recipe request body.
   * @param urls - Webhook URLs to try in order.
   * @returns The response body of the first successful request.
   * @throws The last error when every URL failed.
   */
  async send(payload: RecipeRequestPayload, urls: string[]): Promise<unknown> {
    let lastError: unknown = null;
    for (const url of urls) {
      try {
        return await firstValueFrom(this.http.post(url, payload).pipe(timeout(REQUEST_TIMEOUT_MS)));
      } catch (error) {
        lastError = error;
        console.warn(`Webhook request failed for ${url}:`, error);
      }
    }
    throw lastError ?? new Error('All webhook endpoints failed.');
  }

  /**
   * Extracts status, code, message, validation errors and quota from a failed request.
   * @param error - Error thrown by send().
   * @returns The normalized error details.
   */
  readApiError(error: unknown): ApiErrorDetails {
    if (!(error instanceof HttpErrorResponse)) {
      return { status: null, code: null, message: null, errors: [], quota: null };
    }

    const body = typeof error.error === 'object' && error.error !== null
      ? error.error as { message?: unknown; code?: unknown; errors?: unknown }
      : {};
    return {
      status: error.status,
      code: typeof body.code === 'string' ? body.code : null,
      message: typeof body.message === 'string' && body.message.trim() ? body.message.trim() : null,
      errors: Array.isArray(body.errors) ? body.errors.filter((item): item is string => typeof item === 'string') : [],
      quota: this.readQuota(error.error),
    };
  }

  /**
   * Builds the user-facing error message, preferring the message sent by the server.
   * @param error - Error thrown by send().
   * @returns The server message or a fallback for network and unknown errors.
   */
  toErrorMessage(error: unknown): string {
    if (error instanceof TimeoutError) {
      return this.i18n.t('error.timeout');
    }
    const details = this.readApiError(error);
    // Known server codes get the text of the chosen language; other server texts are shown as sent.
    if (details.code && this.i18n.t(`error.${details.code}`) !== `error.${details.code}`) {
      return this.i18n.t(`error.${details.code}`);
    }
    if (details.message) {
      return details.message;
    }
    if (details.status === 0) {
      return this.i18n.t('error.connection');
    }
    if (details.status === 404) {
      return this.i18n.t('error.notFound');
    }
    if (details.status !== null) {
      return this.getStatusFallbackMessage(details.status);
    }
    return this.i18n.t('error.generic');
  }

  /**
   * Maps a failed request to the dialog kind that explains it best.
   * @param error - Error thrown by send().
   * @returns The dialog kind.
   */
  getDialogKind(error: unknown): RequestDialogKind {
    if (error instanceof TimeoutError) {
      return 'failed';
    }
    const details = this.readApiError(error);
    switch (details.code) {
      case 'QUOTA_EXCEEDED':
      case 'GLOBAL_QUOTA_EXCEEDED':
        return 'limit';
      case 'THROTTLED':
        return 'throttle';
      case 'IP_NOT_DETECTED':
        return 'blocked';
      case 'INVALID_REQUEST':
        return 'invalid';
      case 'RECIPE_GENERATION_FAILED':
      case 'QUOTA_UNAVAILABLE':
        return 'failed';
    }
    return this.getDialogKindFromStatus(details.status, error);
  }

  /**
   * Checks whether a failed request was rejected because a daily limit is used up.
   * @param error - Error thrown by send().
   * @returns True for QUOTA_EXCEEDED and GLOBAL_QUOTA_EXCEEDED responses.
   */
  isLimitError(error: unknown): boolean {
    return this.getDialogKind(error) === 'limit';
  }

  /**
   * Checks whether a failed request never reached the server (network, TLS or CORS problem).
   * @param error - Error thrown by send().
   * @returns True for connection errors.
   */
  isConnectionError(error: unknown): boolean {
    if (error instanceof HttpErrorResponse) {
      return error.status === 0;
    }
    const normalized = this.extractErrorText(error).toLowerCase();
    return ['failed to fetch', 'fetch failed', 'network', 'cors', 'ssl', 'tls', 'certificate']
      .some((part) => normalized.includes(part));
  }

  /**
   * Reads and validates the quota object of a webhook response body.
   * @param payload - Response or error body.
   * @returns The quota status, or null when it is missing or incomplete.
   */
  readQuota(payload: unknown): QuotaStatus | null {
    if (typeof payload !== 'object' || payload === null) {
      return null;
    }
    const quota = (payload as { quota?: unknown }).quota;
    if (!quota || typeof quota !== 'object') {
      return null;
    }

    const candidate = quota as Partial<QuotaStatus>;
    const numberFields = [
      candidate.perIpLimit, candidate.perIpUsed, candidate.perIpRemaining,
      candidate.globalLimit, candidate.globalUsed, candidate.globalRemaining,
    ];
    const isComplete = typeof candidate.date === 'string'
      && typeof candidate.ipAddress === 'string'
      && numberFields.every((value) => typeof value === 'number' && Number.isFinite(value));
    if (!isComplete) {
      return null;
    }

    const ipVersion = candidate.ipVersion === 'ipv4' || candidate.ipVersion === 'ipv6' ? candidate.ipVersion : 'unknown';
    return { ...candidate, ipVersion } as QuotaStatus;
  }

  /**
   * Chooses a dialog kind for errors without a known server code.
   * @param status - HTTP status, or null for non-HTTP errors.
   * @param error - Original error.
   * @returns The dialog kind.
   */
  private getDialogKindFromStatus(status: number | null, error: unknown): RequestDialogKind {
    if (this.isConnectionError(error)) {
      return 'connection';
    }
    if (status === 429) {
      return 'limit';
    }
    if (status === 400) {
      return 'invalid';
    }
    return status !== null && status >= 500 ? 'failed' : 'notice';
  }

  /**
   * Returns a fallback message for HTTP errors without a server message.
   * @param status - HTTP status.
   * @returns A readable fallback text.
   */
  private getStatusFallbackMessage(status: number): string {
    if (status === 429) {
      return this.i18n.t('error.tooMany');
    }
    if (status === 400) {
      return this.i18n.t('error.rejected');
    }
    return this.i18n.t('error.status', { status });
  }

  /**
   * Checks that a webhook URL uses HTTP(S) and points to an n8n production webhook path.
   * @param url - URL to validate.
   * @returns True when the URL is usable.
   */
  private isValidWebhookUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol)
        && /^\/webhook(?:\/|$)/i.test(parsed.pathname)
        && !/^\/workflow(?:\/|$)/i.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  /**
   * Collects all readable text from an unknown error value.
   * @param error - Any thrown value.
   * @returns The joined text parts (possibly empty).
   */
  private extractErrorText(error: unknown): string {
    const values: string[] = [];
    if (typeof error === 'string') {
      values.push(error);
    }
    if (typeof error === 'object' && error !== null) {
      const object = error as { message?: unknown; error?: unknown; detail?: unknown };
      for (const value of [object.message, object.error, object.detail]) {
        if (typeof value === 'string') {
          values.push(value);
        }
      }
    }
    return values.join(' ').trim();
  }
}
