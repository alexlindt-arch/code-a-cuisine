/**
 * @file footer.ts
 * @description Global page footer with the imprint link; hidden on the landing page, which has its own.
 */
import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, startWith } from 'rxjs';

@Component({
  selector: 'app-footer',
  imports: [RouterLink],
  templateUrl: './footer.html',
  styleUrls: ['./footer.scss'],
})
/**
 * Footer that keeps the imprint one click away on every page and follows the page colours
 * through the 'headerStyle' route data (light pages get a light footer).
 */
export class Footer {
  private readonly router = inject(Router);
  private readonly activatedRoute = inject(ActivatedRoute);

  readonly isVisible = signal(false);
  readonly isLight = signal(true);

  /**
   * Updates visibility and colour scheme on every completed navigation.
   */
  constructor() {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        startWith(null),
        takeUntilDestroyed()
      )
      .subscribe(() => this.syncWithRoute());
  }

  /**
   * Hides the footer on the landing page and picks the colours of the active route.
   */
  private syncWithRoute(): void {
    let route = this.activatedRoute;
    while (route.firstChild) {
      route = route.firstChild;
    }
    const path = this.router.url.split(/[?#]/)[0];
    this.isVisible.set(path !== '/' && path !== '');
    this.isLight.set(route.snapshot.data['headerStyle'] !== 'dark');
  }
}
