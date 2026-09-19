/**
 * @file routerlink-componente.ts
 * @description Text link with an arrow (inline SVG) used for back and forward navigation.
 */
import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-routerlink-componente',
  imports: [RouterLink],
  templateUrl: './routerlink-componente.html',
  styleUrls: ['./routerlink-componente.scss'],
})
/**
 * Router link with a decorative arrow; use ariaLabel when the link has no visible text.
 */
export class RouterlinkComponente {
  readonly linkText = input.required<string>();
  readonly targetPath = input.required<string>();
  readonly targetClass = input.required<string>();
  readonly imageArrow = input('assets/icons/Arrow-right.png');
  readonly ariaLabel = input<string | null>(null);
  readonly arrowClass = 'arrow-icon';

  /**
   * Whether the arrow points back (left). The former PNG arrows are replaced by sharp SVG arrows
   * in the link colour, drawn in their direction (never mirrored, so they cannot turn when
   * animated); the imageArrow input only decides the direction now.
   * @returns True for the left pointing arrows.
   */
  readonly isBackArrow = computed(() => this.imageArrow().toLowerCase().includes('left'));
}
