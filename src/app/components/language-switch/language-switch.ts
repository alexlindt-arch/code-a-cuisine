/**
 * @file language-switch.ts
 * @description Green DE / EN switch in the header.
 */
import { Component, inject } from '@angular/core';
import { I18nService } from '../../i18n/i18n.service';
import { TranslatePipe } from '../../i18n/translate.pipe';
import type { Language } from '../../i18n/translations';

@Component({
  selector: 'app-language-switch',
  imports: [TranslatePipe],
  templateUrl: './language-switch.html',
  styleUrls: ['./language-switch.scss'],
})
/**
 * Two-segment toggle; the active language is filled green. The segments are pressed/unpressed
 * buttons, so screen readers announce which language is on.
 */
export class LanguageSwitch {
  readonly i18n = inject(I18nService);
  readonly languages: { id: Language; short: string; nameKey: string }[] = [
    { id: 'de', short: 'DE', nameKey: 'lang.de' },
    { id: 'en', short: 'EN', nameKey: 'lang.en' },
  ];

  /**
   * Switches to the chosen language.
   * @param language - Language to show.
   */
  select(language: Language): void {
    this.i18n.setLanguage(language);
  }
}
