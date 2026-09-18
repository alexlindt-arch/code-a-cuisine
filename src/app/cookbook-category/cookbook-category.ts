/**
 * @file cookbook-category.ts
 * @description Cookbook category page: lists the recipes of one cuisine, or all recipes, with pagination.
 */
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterlinkComponente } from '../components/routerlink-componente/routerlink-componente';
import { ALL_RECIPES_SLUG, findCookbookCategory, type CookbookCategory } from '../cookbook/cookbook-data';
import { RecipeLibraryService, type CookbookRecipeRecord } from '../recipe-library.service';

/** Number of recipes shown per page. */
export const RECIPES_PER_PAGE = 20;

/**
 * Last page shown per category slug during this visit, so coming back from a recipe detail
 * lands on the same page instead of page 1.
 */
const lastPageByCategory = new Map<string, number>();

@Component({
  selector: 'app-cookbook-category',
  imports: [RouterLink, RouterlinkComponente],
  templateUrl: './cookbook-category.html',
  styleUrls: ['./cookbook-category.scss'],
})
/**
 * Shows the saved recipes of the category in the route (slug 'all' shows every recipe), 20 per page.
 */
export class CookbookCategoryPage {
  private readonly route = inject(ActivatedRoute);
  private readonly recipeLibraryService = inject(RecipeLibraryService);

  /** True when Firebase could not be read, so only the preinstalled recipes are listed. */
  readonly databaseUnavailable = this.recipeLibraryService.databaseUnavailable;
  readonly pageSize = RECIPES_PER_PAGE;
  readonly selectedCategory = signal<CookbookCategory | null>(null);
  readonly recipes = signal<CookbookRecipeRecord[]>([]);
  readonly loadingState = signal<'idle' | 'loading' | 'error'>('idle');
  readonly currentPage = signal(1);

  /**
   * Recipes of the selected category; the "all" category is not filtered.
   * @returns The recipes to paginate, newest first.
   */
  readonly displayedRecipes = computed<CookbookRecipeRecord[]>(() => {
    const category = this.selectedCategory();
    if (!category) {
      return [];
    }
    if (category.slug === ALL_RECIPES_SLUG) {
      return this.recipes();
    }

    const selectedCuisine = category.cuisine.trim().toLowerCase();
    return this.recipes().filter((recipe) => recipe.cuisine.trim().toLowerCase() === selectedCuisine);
  });

  /**
   * Path the recipe detail page links back to.
   * @returns The current category path, or the cookbook when no category is selected.
   */
  readonly detailBackPath = computed(() => {
    const category = this.selectedCategory();
    return category ? `/cookbook/${category.slug}` : '/cookbook';
  });

  /**
   * Number of pages for the displayed recipes.
   * @returns At least 1.
   */
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.displayedRecipes().length / this.pageSize)));

  /**
   * Zero-based index of the first recipe on the current page.
   * @returns The start index.
   */
  readonly pageStartIndex = computed(() => (Math.min(this.currentPage(), this.totalPages()) - 1) * this.pageSize);

  /**
   * Recipes shown on the current page.
   * @returns Up to pageSize recipes.
   */
  readonly visibleRecipes = computed(() =>
    this.displayedRecipes().slice(this.pageStartIndex(), this.pageStartIndex() + this.pageSize)
  );

  /**
   * Page numbers for the pagination buttons.
   * @returns The numbers 1..totalPages.
   */
  readonly pageNumbers = computed(() =>
    Array.from({ length: this.totalPages() }, (_, index) => index + 1)
  );

  /**
   * Range of the shown recipes, e.g. "Recipes 21–40 of 57".
   * @returns The pagination status text.
   */
  readonly paginationLabel = computed(() => {
    const total = this.displayedRecipes().length;
    const first = total ? this.pageStartIndex() + 1 : 0;
    const last = Math.min(this.pageStartIndex() + this.pageSize, total);
    return `Recipes ${first}–${last} of ${total}`;
  });

  /**
   * Whether a previous page exists.
   * @returns True when the current page is not the first one.
   */
  readonly hasPreviousPage = computed(() => this.currentPage() > 1);

  /**
   * Whether a next page exists.
   * @returns True when the current page is not the last one.
   */
  readonly hasNextPage = computed(() => this.currentPage() < this.totalPages());

  /**
   * Loads the recipes and follows the category route parameter.
   */
  constructor() {
    void this.loadRecipes();

    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const category = findCookbookCategory(params.get('category'));
      this.selectedCategory.set(category);
      this.currentPage.set((category && lastPageByCategory.get(category.slug)) || 1);
    });
  }

  /**
   * Formats a stored cuisine id for display.
   * @param cuisine - Cuisine id or label, e.g. "italian".
   * @returns The capitalized label, e.g. "Italian".
   */
  formatCuisine(cuisine: string): string {
    const trimmed = cuisine.trim();
    return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : trimmed;
  }

  /**
   * Shows a page and scrolls back to the top of the list.
   * @param pageNumber - Page to show (clamped to the available pages).
   */
  selectPage(pageNumber: number): void {
    const nextPage = Math.min(Math.max(1, pageNumber), this.totalPages());
    if (nextPage === this.currentPage()) {
      return;
    }
    this.currentPage.set(nextPage);
    const category = this.selectedCategory();
    if (category) {
      lastPageByCategory.set(category.slug, nextPage);
    }
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  /**
   * Shows the previous page, if any.
   */
  goToPreviousPage(): void {
    if (this.hasPreviousPage()) {
      this.selectPage(this.currentPage() - 1);
    }
  }

  /**
   * Shows the next page, if any.
   */
  goToNextPage(): void {
    if (this.hasNextPage()) {
      this.selectPage(this.currentPage() + 1);
    }
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
      console.error('Failed to load category recipes from Firebase:', error);
      this.loadingState.set('error');
    }
  }
}
