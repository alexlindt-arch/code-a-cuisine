/**
 * @file app.ts
 * @description Root component: global header and the single main landmark around the routed pages.
 */
import { Component, signal, inject } from '@angular/core';
import { RouterOutlet, ActivatedRoute } from '@angular/router';
import { Header } from './components/header/header';
import { clearStoredIngredients, RECIPE_CONTEXT_STORAGE_KEY } from './generate-recipe/generate-recipe.utils';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Header],
  templateUrl: './app.html',
  styleUrls: ['./app.scss']
})
/**
 * Root component of the application; keeps the title in sync with the route data.
 */
export class App {
  protected readonly title = signal('Code-a-Cuisine');
  private activatedRoute = inject(ActivatedRoute);

  /**
   * Starts every page load with an empty ingredient list and keeps the title in sync with
   * the route data. The list only survives navigation inside the app (generate recipe ->
   * preferences), not a reload.
   */
  constructor() {
    clearStoredIngredients(RECIPE_CONTEXT_STORAGE_KEY);
    this.activatedRoute.data.subscribe((data) => {
      if (data['title']) {
        this.title.set(data['title']);
      }
    });
  }
}
