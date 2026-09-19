/**
 * @file i18n-title.strategy.ts
 * @description Sets the browser tab title from the route's title key in the current language.
 */
import { effect, inject, Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { I18nService } from './i18n.service';

/**
 * Route titles are text keys (e.g. 'title.cookbook'); the tab title follows the language switch.
 */
@Injectable({ providedIn: 'root' })
export class I18nTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly i18n = inject(I18nService);
  private currentKey = 'title.home';

  /**
   * Updates the tab title again whenever the language changes.
   */
  constructor() {
    super();
    effect(() => {
      this.i18n.language();
      this.applyTitle();
    });
  }

  /**
   * Called by the router after each navigation.
   * @param snapshot - Router state after the navigation.
   */
  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.currentKey = this.buildTitle(snapshot) ?? 'title.home';
    this.applyTitle();
  }

  /**
   * Writes the translated title, with the app name for every page but the start page.
   */
  private applyTitle(): void {
    const text = this.i18n.t(this.currentKey);
    this.title.setTitle(this.currentKey === 'title.home' ? text : `${text} | Code à Cuisine`);
  }
}
