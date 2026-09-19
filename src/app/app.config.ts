/**
 * @file app.config.ts
 * @description Application providers: global error listeners, hash-based router, HttpClient and translated tab titles.
 */
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, TitleStrategy, withHashLocation } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';

import { routes } from './app.routes';
import { I18nTitleStrategy } from './i18n/i18n-title.strategy';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Hash URLs keep deep links working on hosts that ignore .htaccess rewrites.
    provideRouter(routes, withHashLocation()),
    provideHttpClient(),
    // Route titles are text keys, translated into the current language.
    { provide: TitleStrategy, useClass: I18nTitleStrategy },
  ]
};