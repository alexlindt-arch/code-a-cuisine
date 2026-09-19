/**
 * @file language-switch.spec.ts
 * @description Unit tests for the DE / EN switch and the text lookup.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LanguageSwitch } from './language-switch';
import { I18nService } from '../../i18n/i18n.service';
import { DE, EN } from '../../i18n/translations';

describe('LanguageSwitch', () => {
  let fixture: ComponentFixture<LanguageSwitch>;
  let i18n: I18nService;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({ imports: [LanguageSwitch] }).compileComponents();
    fixture = TestBed.createComponent(LanguageSwitch);
    i18n = TestBed.inject(I18nService);
    i18n.setLanguage('en');
    fixture.detectChanges();
  });

  it('should switch to German and remember it', () => {
    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll('button');
    buttons[0].click();
    fixture.detectChanges();
    expect(i18n.language()).toBe('de');
    expect(localStorage.getItem('cac-language')).toBe('de');
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    expect(i18n.t('hero.hungry')).toBe('Lust auf Inspiration?');
  });

  it('should fill placeholders', () => {
    expect(i18n.t('results.recipe', { number: 2 })).toBe('Recipe 2');
  });

  it('should have a German text for every English key', () => {
    expect(Object.keys(DE).sort()).toEqual(Object.keys(EN).sort());
  });
});
