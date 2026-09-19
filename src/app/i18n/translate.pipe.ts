/**
 * @file translate.pipe.ts
 * @description Template pipe for interface texts: {{ 'hero.hungry' | t }}.
 */
import { inject, Pipe, PipeTransform } from '@angular/core';
import { I18nService, type TranslationParams } from './i18n.service';

/**
 * Looks up a text in the current language. The pipe is impure, so a language switch updates
 * every text at once without reloading the page.
 */
@Pipe({ name: 't', pure: false })
export class TranslatePipe implements PipeTransform {
  private readonly i18n = inject(I18nService);

  /**
   * Translates a key.
   * @param key - Text key.
   * @param params - Values for the {placeholders}.
   * @returns The text in the current language.
   */
  transform(key: string, params?: TranslationParams): string {
    return this.i18n.t(key, params);
  }
}
