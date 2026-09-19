/**
 * @file logo.ts
 * @description Code à Cuisine logo drawn from the chef hat mask and live text, so it stays sharp at every size.
 */
import { Component } from '@angular/core';

/**
 * Logo mark and name. The colours come from the custom properties `--logo-mark-color` and
 * `--logo-text-color` of the parent, so every place can tint it for its background.
 */
@Component({
  selector: 'app-logo',
  templateUrl: './logo.html',
  styleUrl: './logo.scss',
})
export class Logo {}
