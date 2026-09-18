/**
 * @file results.ts
 * @description Results page: shows the generated recipes and saves them to the cookbook database.
 */
import { Component, computed, OnDestroy, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { inject } from '@angular/core';
import { RecipeLibraryService, type StoredRecipeRequestPayload, type StoredRecipeResult } from '../recipe-library.service';
import { RouterlinkComponente } from '../components/routerlink-componente/routerlink-componente';
import { extractResult, parseRecipeArray } from '../recipe-detail/recipe-detail.utils';

/**
 * A generated recipe shown as a result card.
 */
type Recipe = StoredRecipeResult;

@Component({
  selector: 'app-results',
  imports: [ RouterLink, RouterlinkComponente],
  templateUrl: './results.html',
  styleUrls: ['./results.scss'],
})
/**
 * Loads the stored webhook response, renders one card per recipe and persists new results to Firebase.
 */
export class Results implements OnDestroy {
  private readonly responseKey = 'cac-recipe-results';
  private readonly requestKey = 'cac-recipe-request';
  private readonly ingredientsKey = 'cac-ingredients';
  private readonly errorKey = 'cac-recipe-error';
  private readonly persistedMarkerKey = 'cac-recipe-results-persisted';
  private readonly savedRecipeIdsKey = 'cac-saved-recipe-ids';
  private readonly router = inject(Router);
  private readonly recipeLibraryService = inject(RecipeLibraryService);
  private savedNoticeTimeoutId: ReturnType<typeof window.setTimeout> | null = null;

  readonly recipes = signal<Recipe[]>([]);
  readonly requestPayload = signal<StoredRecipeRequestPayload | null>(null);
  readonly hasStoredResponse = signal(false);
  readonly generationError = signal<string | null>(null);
  readonly persistenceState = signal<'idle' | 'saving' | 'saved' | 'error'>('idle');
  readonly heroImageArrow = 'assets/icons/Arrow-left-dark.png';
  readonly arrowClass = 'arrow-icon';

  /** Whether at least one recipe could be parsed. */
  readonly hasResults = computed(() => this.recipes().length > 0);

  /** Human readable cuisine of the request (e.g. "italian" becomes "Italian"), or null when unknown. */
  readonly cuisineLabel = computed(() => {
    const cuisine = this.requestPayload()?.preferences.cuisine;
    if (typeof cuisine !== 'string' || !cuisine.trim()) {
      return null;
    }

    const trimmed = cuisine.trim();
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  });

  /**
   * Loads request, error and recipes from localStorage.
   */
  constructor() {
    this.loadRequestPayload();
    this.loadGenerationError();
    this.loadRecipes();
  }

  /**
   * Reads the last generation error message from localStorage.
   */
  private loadGenerationError() {
    const raw = localStorage.getItem(this.errorKey);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === 'string' && parsed.trim()) {
        this.generationError.set(parsed);
      }
    } catch {
      this.generationError.set(raw);
    }
  }

  /**
   * Reads the stored request payload (ingredients and preferences) from localStorage.
   */
  private loadRequestPayload() {
    const raw = localStorage.getItem(this.requestKey);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as StoredRecipeRequestPayload;
      if (parsed && parsed.preferences && Array.isArray(parsed.ingredients) && typeof parsed.requestedAt === 'string') {
        this.requestPayload.set(parsed);
      }
    } catch (error) {
      console.error('Failed to parse request payload:', error);
    }
  }

  /**
   * Parses the stored webhook response (including the new optional recipe fields) and triggers persistence.
   */
  private loadRecipes() {
    const raw = localStorage.getItem(this.responseKey);
    if (!raw) {
      return;
    }

    this.hasStoredResponse.set(true);

    try {
      const parsed = JSON.parse(raw) as unknown;
      // The workflow always answers with exactly three recipes; never show more.
      const recipes = parseRecipeArray(extractResult(parsed)).slice(0, 3);
      this.recipes.set(recipes);
      void this.persistRecipesIfNeeded(recipes);
    } catch (error) {
      console.error('Failed to parse recipe response:', error);
    }
  }

  /**
   * Saves the recipes to Firebase once per generation request.
   * @param recipes The parsed recipes.
   * @returns A promise that resolves when saving has finished or failed.
   */
  private async persistRecipesIfNeeded(recipes: Recipe[]) {
    const requestPayload = this.requestPayload();
    if (!requestPayload || recipes.length === 0) {
      return;
    }

    const persistedMarker = localStorage.getItem(this.persistedMarkerKey);
    if (persistedMarker === requestPayload.requestedAt) {
      this.showSavedStateTemporarily();
      return;
    }

    this.persistenceState.set('saving');

    try {
      const savedRecipeIds = await this.recipeLibraryService.saveGeneratedRecipes(recipes, requestPayload);
      localStorage.setItem(this.persistedMarkerKey, requestPayload.requestedAt);
      localStorage.setItem(this.savedRecipeIdsKey, JSON.stringify(savedRecipeIds));
      this.showSavedStateTemporarily();
    } catch (error) {
      console.error('Failed to persist generated recipes to Firebase:', error);
      this.clearSavedNoticeTimer();
      this.persistenceState.set('error');
    }
  }

  /**
   * Shows the "saved" notice for four seconds.
   */
  private showSavedStateTemporarily(): void {
    this.clearSavedNoticeTimer();
    this.persistenceState.set('saved');
    this.savedNoticeTimeoutId = window.setTimeout(() => {
      this.persistenceState.set('idle');
      this.savedNoticeTimeoutId = null;
    }, 4000);
  }

  /**
   * Cancels a pending "saved" notice timer.
   */
  private clearSavedNoticeTimer(): void {
    if (this.savedNoticeTimeoutId !== null) {
      clearTimeout(this.savedNoticeTimeoutId);
      this.savedNoticeTimeoutId = null;
    }
  }

  /**
   * Returns the hero image of the results page.
   * @returns Path of the hero image.
   */
  getHeroImage(): string {
    return 'assets/img/ChatGPT-Image.png';
  }

  /**
   * Returns the icon shown on each recipe card.
   * @returns Path of the card icon.
   */
  getRecipeCardIcon(): string {
    return 'assets/icons/deckel-ickon.png';
  }

  /**
   * Maps a cooking time to a difficulty label.
   * @param minutes Estimated cooking time in minutes.
   * @returns "Quick", "Medium" or "Complex".
   */
  getDurationLabel(minutes: number): string {
    if (minutes <= 20) {
      return 'Quick';
    }

    if (minutes <= 45) {
      return 'Medium';
    }

    return 'Complex';
  }

  /**
   * Clears the notice timer when the page is left.
   */
  ngOnDestroy(): void {
    this.clearSavedNoticeTimer();
  }

  /**
   * Clears the stored recipe session and navigates back to the ingredient input.
   * @param event The click event of the link.
   * @returns A promise that resolves after navigation.
   */
  async startNewRecipeSession(event: Event): Promise<void> {
    event.preventDefault();

    try {
      localStorage.removeItem(this.ingredientsKey);
      localStorage.removeItem(this.requestKey);
      localStorage.removeItem(this.responseKey);
      localStorage.removeItem(this.errorKey);
      localStorage.removeItem(this.persistedMarkerKey);
      localStorage.removeItem(this.savedRecipeIdsKey);
    } catch (error) {
      console.error('Failed to reset recipe session storage:', error);
    }

    await this.router.navigate(['/generate-recipe']);
  }
}
