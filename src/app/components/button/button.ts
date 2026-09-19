/**
 * @file button.ts
 * @description Primary call-to-action button of the landing page.
 */
import { Component, input } from '@angular/core';
import { TranslatePipe } from '../../i18n/translate.pipe';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-button',
  imports: [RouterLink, TranslatePipe],
  templateUrl: './button.html',
  styleUrls: ['./button.scss'],
})
/**
 * Call-to-action link styled as a button, with the translated label "Get started". It is a real link, so it
 * has one tab stop and opens its target with Enter like any other link.
 */
export class Button {
  readonly link = input.required<string>();
  label = 'hero.getStarted';
}
