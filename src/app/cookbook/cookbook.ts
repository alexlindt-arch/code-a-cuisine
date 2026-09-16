/**
 * @file cookbook.ts
 * @description Cookbook overview page: most liked recipes, link to all recipes and the cuisine categories.
 */
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RouterlinkComponente } from '../components/routerlink-componente/routerlink-componente';
import { ALL_RECIPES_SLUG, cookbookCategories } from './cookbook-data';
import { RecipeLibraryService, type CookbookRecipeRecord } from '../recipe-library.service';

@Component({
  selector: 'app-cookbook',
  imports: [RouterLink, RouterlinkComponente],
  templateUrl: './cookbook.html',
  styleUrls: ['./cookbook.scss'],
})
/**
 * Cookbook overview: loads all saved recipes (no account needed) and shows the three most liked ones.
 */
export class Cookbook {
  private readonly recipeLibraryService = inject(RecipeLibraryService);

  /** True when Firebase could not be read, so only the preinstalled recipes are listed. */
  readonly databaseUnavailable = this.recipeLibraryService.databaseUnavailable;

  readonly categories = cookbookCategories;
  readonly allRecipesPath = `/cookbook/${ALL_RECIPES_SLUG}`;
  readonly recipes = signal<CookbookRecipeRecord[]>([]);
  readonly loadingState = signal<'idle' | 'loading' | 'error'>('idle');

  /**
   * The three recipes with the most likes.
   * @returns Up to three recipes, most liked first.
   */
  readonly featuredRecipes = computed(() =>
    [...this.recipes()]
      .sort((firstRecipe, secondRecipe) => secondRecipe.likes - firstRecipe.likes)
      .slice(0, 3)
  );

  /**
   * Starts loading the recipes from Firebase.
   */
  constructor() {
    void this.loadRecipes();
  }

  /**
   * Loads all recipes from Firebase and updates the loading state.
   * @returns A promise that resolves when loading has finished (errors are logged).
   */
  private async loadRecipes(): Promise<void> {
    this.loadingState.set('loading');

    try {
      const recipes = await this.recipeLibraryService.getAllRecipes();
      this.recipes.set(recipes);
      this.loadingState.set('idle');
    } catch (error) {
      console.error('Failed to load cookbook recipes from Firebase:', error);
      this.loadingState.set('error');
    }
  }
}
