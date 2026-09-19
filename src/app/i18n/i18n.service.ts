/**
 * @file i18n.service.ts
 * @description Current interface language (English or German) and text lookup.
 */
import { DOCUMENT } from '@angular/common';
import { effect, inject, Injectable, signal } from '@angular/core';
import { DE, EN, type Language, type TranslationKey } from './translations';

/** localStorage key of the chosen language. */
const LANGUAGE_STORAGE_KEY = 'cac-language';

/** Values that replace {placeholders} in a text. */
export type TranslationParams = Record<string, string | number>;

/**
 * Holds the interface language as a signal, so every template that reads a text updates as soon
 * as the language changes. The choice is remembered in the browser; on the first visit the
 * browser language decides.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly document = inject(DOCUMENT);
  readonly language = signal<Language>(this.readInitialLanguage());

  /**
   * Keeps the lang attribute of the page in sync with the chosen language.
   */
  constructor() {
    effect(() => {
      this.document.documentElement.lang = this.language();
    });
  }

  /**
   * Switches the interface language and remembers the choice.
   * @param language - New language.
   */
  setLanguage(language: Language): void {
    this.language.set(language);
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // Storage can be blocked (private mode); the choice then lasts for this visit only.
    }
  }

  /**
   * Returns the text for a key in the current language.
   * @param key - Text key.
   * @param params - Values for the {placeholders} in the text.
   * @returns The translated text; the English text or the key itself when a text is missing.
   */
  t(key: TranslationKey | string, params?: TranslationParams): string {
    const dictionary: Record<string, string> = this.language() === 'de' ? DE : EN;
    const text = dictionary[key] ?? (EN as Record<string, string>)[key] ?? key;
    if (!params) {
      return text;
    }
    return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
  }

  /**
   * Translates a stored option id (cuisine, diet, time, unit), e.g. label('cuisine', 'italian').
   * @param prefix - Key group.
   * @param id - Stored id; unknown ids are shown capitalized.
   * @returns The translated label.
   */
  label(prefix: 'cuisine' | 'diet' | 'time' | 'unit', id: string | null | undefined): string {
    const normalized = String(id ?? '').trim().toLowerCase();
    const key = `${prefix}.${normalized}`;
    const text = this.t(key);
    if (text !== key) {
      return text;
    }
    return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : '';
  }

  /**
   * Picks the saved language, otherwise German for German browsers and English for all others.
   * @returns The language to start with.
   */
  private readInitialLanguage(): Language {
    try {
      const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (stored === 'de' || stored === 'en') {
        return stored;
      }
    } catch {
      // Ignore blocked storage.
    }
    const browserLanguage = typeof navigator !== 'undefined' ? navigator.language : 'en';
    return browserLanguage.toLowerCase().startsWith('de') ? 'de' : 'en';
  }
}
