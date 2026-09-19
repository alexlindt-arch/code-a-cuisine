/**
 * @file header.ts
 * @description Global page header with the logo link and the language switch; switches between dark and light style per route.
 */
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { filter, startWith } from 'rxjs';
import { LoadingStateService } from '../../loading-state.service';
import { LanguageSwitch } from '../language-switch/language-switch';
import { TranslatePipe } from '../../i18n/translate.pipe';

@Component({
  selector: 'app-header',
  imports: [RouterLink, LanguageSwitch, TranslatePipe],
  providers: [],
  templateUrl: './header.html',
  styleUrls: ['./header.scss'],
})
/**
 * Header component; reads the 'headerStyle' route data after each navigation.
 */
export class Header {
  private readonly router = inject(Router);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly loadingStateService = inject(LoadingStateService);

  readonly isLightHeader = signal(false);
  readonly isLoading = this.loadingStateService.isLoading;

  /**
   * Whether the logo uses its dark colours (green on white pages).
   * @returns False while loading or on dark headers, where the light logo sits on green.
   */
  readonly isDarkLogo = computed(() => this.isLightHeader() && !this.isLoading());

  /**
   * Updates the header style on every completed navigation.
   */
  constructor() {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        startWith(null),
        takeUntilDestroyed()
      )
      .subscribe(() => this.syncHeaderStateFromRoute());
  }

  /**
   * Sets the light header when the deepest active route has headerStyle 'light'.
   */
  private syncHeaderStateFromRoute(): void {
    const deepestRoute = this.getDeepestRoute(this.activatedRoute);
    const headerStyle = deepestRoute.snapshot.data['headerStyle'];
    this.isLightHeader.set(headerStyle === 'light');
  }

  /**
   * Walks down the route tree to the most specific active route.
   * @param route - Route to start from.
   * @returns The deepest activated route.
   */
  private getDeepestRoute(route: ActivatedRoute): ActivatedRoute {
    let currentRoute = route;

    while (currentRoute.firstChild) {
      currentRoute = currentRoute.firstChild;
    }
    return currentRoute;
  }
}
