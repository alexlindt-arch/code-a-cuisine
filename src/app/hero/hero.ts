/**
 * @file hero.ts
 * @description Landing page with the call to action, the cookbook link and decorative dish images.
 */
import { Component } from '@angular/core';
import { TranslatePipe } from '../i18n/translate.pipe';
import { Button } from '../components/button/button';
import { ImagesComponent } from '../components/images-component/images-component';
import { RouterlinkComponente } from '../components/routerlink-componente/routerlink-componente';
import { RouterLink } from "@angular/router";

@Component({
  selector: 'app-hero',
  imports: [Button, ImagesComponent, RouterLink, RouterlinkComponente, TranslatePipe],
  standalone: true,
  templateUrl: './hero.html',
  styleUrls: ['./hero.scss'],
})
/**
 * Hero section of the landing page; holds image paths, CSS classes and route targets.
 */
export class Hero {
  heroImageOne = 'assets/img/menu-3.png';
  heroImageTwo = 'assets/img/menu-2.png';
  heroImageThree = 'assets/img/menu-1.png';
  heroImageFour = 'assets/img/menu-4.png';
  heroImageFive = 'assets/img/menu-5.png';
  heroImageClass = 'hero-image';
  arrowClass = 'arrow-icon';
  heroImageArrow = 'assets/icons/Arrow-right.png';
  recipeRouterLink: string = '/generate-recipe';
  cookbookRouterLink: string = '/cookbook';
  impressRouterLink: string = '/impress';
}
