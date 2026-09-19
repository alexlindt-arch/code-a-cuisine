/**
 * @file recipe-detail.ts
 * @description Recipe detail page: ingredients, per-cook directions, nutrition and likes of one recipe.
 */
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { combineLatest } from 'rxjs';
import { RouterlinkComponente } from '../components/routerlink-componente/routerlink-componente';
import { I18nService } from '../i18n/i18n.service';
import { TranslatePipe } from '../i18n/translate.pipe';
import { RecipeLibraryService, type CookbookRecipeRecord } from '../recipe-library.service';
import {
  buildCookTodoLists,
  extractResult,
  getCookIconSrc,
  parseRecipeArray,
  splitIngredients,
  toMacroRows,
  toStepView,
  type CookTodoList,
  type MacroKey,
  type RecipeShape,
  type RecipeStepView,
} from './recipe-detail.utils';

/**
 * A recipe shown on the detail page, optionally with its like count.
 */
interface Recipe extends RecipeShape {
  likes?: number;
}

/**
 * The request (ingredients and preferences) that produced the recipe.
 */
interface RecipeRequestPayload {
  ingredients: Array<{ name: string; quantity: number; unit: string }>;
  preferences: {
    portions: number;
    cooks: number;
    cookingTime: string;
    cuisine: string;
    diets: string[];
  };
}

/** Which nutrition values are displayed. */
export type NutritionView = 'perPortion' | 'total';

/** One slice of the macro donut chart. */
interface DonutSegment {
  key: MacroKey;
  color: string;
  dashArray: string;
  dashOffset: number;
}

/** Chart colors per macro nutrient (also used for the legend swatches). */
const macroColors: Record<MacroKey, string> = {
  protein: '#1E5515',
  carbs: '#D4953A',
  fat: '#9C4A2F',
};

@Component({
  selector: 'app-recipe-detail',
  imports: [RouterLink, RouterlinkComponente, TranslatePipe],
  templateUrl: './recipe-detail.html',
  styleUrls: ['./recipe-detail.scss'],
})
/**
 * Shows a generated recipe (from the results) or a cookbook recipe (from Firebase).
 */
export class RecipeDetail {
  private readonly responseKey = 'cac-recipe-results';
  private readonly requestKey = 'cac-recipe-request';
  private readonly savedRecipeIdsKey = 'cac-saved-recipe-ids';
  private readonly likedRecipeIdsKey = 'cac-liked-recipe-ids';
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly recipeLibraryService = inject(RecipeLibraryService);
  readonly i18n = inject(I18nService);

  readonly recipes = signal<Recipe[]>([]);
  readonly requestPayload = signal<RecipeRequestPayload | null>(null);
  readonly selectedRecipe = signal<Recipe | null>(null);
  readonly selectedRecipeId = signal<string | null>(null);
  /** True while a cookbook recipe is fetched, so the page shows a loading note instead of "not found". */
  readonly isLoadingRecipe = signal(false);
  readonly savedRecipeIds = signal<string[]>([]);
  readonly likedRecipeIds = signal<string[]>([]);
  readonly likeCount = signal<number | null>(null);
  readonly likeState = signal<'idle' | 'saving' | 'saved' | 'error'>('idle');
  readonly backLink = signal('/results');
  readonly nutritionView = signal<NutritionView>('perPortion');
  readonly ingredientsExpanded = signal(false);
  readonly directionsExpanded = signal(false);
  readonly heroImageArrow = 'assets/icons/Arrow-left-dark.png';
  readonly sectionBannerMobIngredients = 'assets/img/Ingredients-Mob.svg';
  readonly sectionBannerMobDirections = 'assets/img/Directions-Mob.svg';
  readonly arrowClass = 'arrow-icon';
  readonly macroColors = macroColors;
  /** Circumference-independent length of the donut path (percent based). */
  readonly donutPathLength = 100;

  /** Label of the back link, depending on where the user came from. */
  readonly backLinkLabel = computed(() => this.backLink().startsWith('/results') ? 'detail.backResults' : 'common.cookbook');

  /** Route path of the current page. */
  readonly path = computed(() => this.activatedRoute.snapshot.routeConfig?.path ?? '');

  /** Number of cooks chosen for the recipe, clamped to the available cook icons (1..3). */
  readonly cookIconCount = computed(() => {
    const cooks = this.requestPayload()?.preferences.cooks;
    if (typeof cooks !== 'number' || !Number.isFinite(cooks)) {
      return 1;
    }

    return Math.min(3, Math.max(1, Math.floor(cooks)));
  });

  /** One-based cook numbers used to render the chef icons. */
  readonly cookIconIndexes = computed(() =>
    Array.from({ length: this.cookIconCount() }, (_, index) => index + 1)
  );

  /** Whether more than one cook is involved. */
  readonly hasSecondChef = computed(() => this.cookIconCount() > 1);

  /** Whether the current user has already liked the selected recipe. */
  readonly isLikedByUser = computed(() => {
    const selectedRecipeId = this.selectedRecipeId();
    if (!selectedRecipeId) {
      return false;
    }

    return this.likedRecipeIds().includes(selectedRecipeId);
  });

  /**
   * "Your ingredients" (left) and "Extra ingredients" (right).
   * Uses the explicit extraIngredients list when present, otherwise name matching against the request.
   */
  readonly ingredientColumns = computed(() => {
    const recipe = this.selectedRecipe();
    if (!recipe) {
      return { left: [] as string[], right: [] as string[] };
    }

    const requestedNames = (this.requestPayload()?.ingredients ?? []).map((ingredient) => ingredient.name);
    const { yours, extras } = splitIngredients(recipe, requestedNames);
    return { left: yours, right: extras };
  });

  /** Whether the recipe has structured steps with cook assignments. */
  readonly hasStepDetails = computed(() => (this.selectedRecipe()?.stepDetails?.length ?? 0) > 0);

  /** One chronological to-do list per cook, built from the structured steps. */
  readonly cookTodoLists = computed<CookTodoList[]>(() => {
    const stepDetails = this.selectedRecipe()?.stepDetails;
    if (!stepDetails?.length) {
      return [];
    }

    return buildCookTodoLists(stepDetails, this.cookIconCount());
  });

  /** Legacy step layout for recipes without structured steps: steps split evenly into one column per cook. */
  readonly stepColumns = computed(() => {
    const steps = this.stepViews();
    const columnsCount = this.cookIconCount();
    const columns = Array.from({ length: columnsCount }, () => [] as RecipeStepView[]);

    if (!steps.length) {
      return { columns };
    }

    let offset = 0;
    for (let columnIndex = 0; columnIndex < columnsCount; columnIndex += 1) {
      const baseSize = Math.floor(steps.length / columnsCount);
      const remainder = steps.length % columnsCount;
      const size = baseSize + (columnIndex < remainder ? 1 : 0);
      columns[columnIndex] = steps.slice(offset, offset + size);
      offset += size;
    }

    return { columns };
  });

  /** Title/description views of the plain step strings. */
  readonly stepViews = computed(() => {
    const recipe = this.selectedRecipe();
    if (!recipe) {
      return [] as RecipeStepView[];
    }

    return recipe.steps.map((rawStep, index) => toStepView(rawStep, index));
  });

  /** Like count to display: the freshly loaded count, otherwise the recipe's stored likes. */
  readonly displayedLikes = computed(() => {
    const explicitLikeCount = this.likeCount();
    if (typeof explicitLikeCount === 'number') {
      return explicitLikeCount;
    }

    const recipeLikes = this.selectedRecipe()?.likes;
    return typeof recipeLikes === 'number' ? recipeLikes : 0;
  });

  /** Number of portions of the request, or null when unknown. */
  readonly portions = computed(() => {
    const portions = this.requestPayload()?.preferences.portions;
    return typeof portions === 'number' && Number.isFinite(portions) && portions > 0 ? portions : null;
  });

  /**
   * Nutrition values for the selected view (per portion or whole recipe),
   * or null when the recipe has no nutrition data.
   */
  readonly nutritionFacts = computed(() => {
    const nutrition = this.selectedRecipe()?.nutrition;
    if (!nutrition) {
      return null;
    }

    const macros = nutrition[this.nutritionView()];
    const rows = toMacroRows(macros);
    return {
      calories: Math.round(macros.calories),
      rows,
      hasMacroEnergy: rows.some((row) => row.percent > 0),
    };
  });

  /** Donut chart segments of the macro energy shares. */
  readonly donutSegments = computed<DonutSegment[]>(() => {
    const facts = this.nutritionFacts();
    if (!facts?.hasMacroEnergy) {
      return [];
    }

    let offset = 0;
    return facts.rows
      .filter((row) => row.percent > 0)
      .map((row) => {
        const segment: DonutSegment = {
          key: row.key,
          color: macroColors[row.key],
          dashArray: `${row.percent} ${this.donutPathLength - row.percent}`,
          dashOffset: -offset,
        };
        offset += row.percent;
        return segment;
      });
  });

  /** Text alternative of the macro chart for screen readers. */
  readonly chartDescription = computed(() => {
    const facts = this.nutritionFacts();
    if (!facts) {
      return '';
    }

    const shares = facts.rows.map((row) => `${this.i18n.t(row.label)} ${row.percent}%`).join(', ');
    return this.i18n.t('detail.chartLabel', { calories: facts.calories, scope: this.nutritionViewLabel(), shares });
  });

  /** Lower-case description of the current nutrition view, used in sentences. */
  readonly nutritionViewLabel = computed(() => {
    if (this.nutritionView() === 'perPortion') {
      return this.i18n.t('detail.scopePortion');
    }

    const portions = this.portions();
    return portions ? this.i18n.t('detail.scopeWholeCount', { portions }) : this.i18n.t('detail.scopeWhole');
  });

  /**
   * Computes the global step number in the legacy column layout.
   * @param columnIndex Zero-based column index.
   * @param stepIndex Zero-based step index inside the column.
   * @returns The one-based step number across all columns.
   */
  getStepNumber(columnIndex: number, stepIndex: number): number {
    const columns = this.stepColumns().columns;
    let previousColumnSize = 0;

    for (let index = 0; index < columnIndex; index += 1) {
      previousColumnSize += columns[index]?.length ?? 0;
    }

    return previousColumnSize + stepIndex + 1;
  }

  /**
   * Returns the chef icon of a cook.
   * @param cook One-based cook number.
   * @returns Path of the cook icon.
   */
  getCookIcon(cook: number): string {
    return getCookIconSrc(cook);
  }

  /**
   * Loads stored data and selects the recipe from the route.
   */
  constructor() {
    this.loadRequestPayload();
    this.loadRecipes();
    this.loadSavedRecipeIds();
    this.loadLikedRecipeIds();

    combineLatest([
      this.activatedRoute.paramMap,
      this.activatedRoute.queryParamMap,
    ]).pipe(takeUntilDestroyed()).subscribe(([params, queryParams]) => {
      const recipeId = params.get('recipeId');
      if (recipeId) {
        this.setBackLinkFromQueryParam(queryParams.get('from'), '/cookbook');
        void this.selectCookbookRecipeFromRoute(recipeId);
        return;
      }

      this.setBackLinkFromQueryParam(queryParams.get('from'), '/results');
      this.selectResultRecipeFromRoute(params.get('index'));
    });
  }

  /**
   * Switches the displayed nutrition values.
   * @param view "perPortion" or "total".
   */
  setNutritionView(view: NutritionView): void {
    this.nutritionView.set(view);
  }

  /**
   * Sets the back link from the "from" query parameter, allowing only results and cookbook paths.
   * @param fromParam Value of the "from" query parameter.
   * @param fallbackPath Path used when the parameter is missing or not allowed.
   */
  private setBackLinkFromQueryParam(fromParam: string | null, fallbackPath: '/results' | '/cookbook') {
    if (!fromParam) {
      this.backLink.set(fallbackPath);
      return;
    }

    const normalizedPath = fromParam.trim();
    const isAllowedPath = normalizedPath.startsWith('/results') || normalizedPath.startsWith('/cookbook');
    this.backLink.set(isAllowedPath ? normalizedPath : fallbackPath);
  }

  /**
   * Selects a recipe of the current results by its index in the route.
   * @param indexParam Value of the "index" route parameter.
   */
  private selectResultRecipeFromRoute(indexParam: string | null) {
    const index = Number(indexParam);

    if (!Number.isInteger(index) || index < 0 || index >= this.recipes().length) {
      this.selectedRecipe.set(null);
      this.selectedRecipeId.set(null);
      this.likeCount.set(null);
      this.likeState.set('idle');
      return;
    }

    this.selectedRecipe.set(this.recipes()[index]);
    const recipeId = this.savedRecipeIds()[index] ?? null;
    this.selectedRecipeId.set(recipeId);
    this.likeCount.set(null);
    this.likeState.set('idle');

    if (recipeId) {
      void this.refreshLikeCount(recipeId);
    }
  }

  /**
   * Fetches the persisted like count from Firebase so it survives a reload.
   * @param recipeId Firebase id of the recipe.
   * @returns A promise that resolves when the count was loaded or failed.
   */
  private async refreshLikeCount(recipeId: string) {
    try {
      const recipe = await this.recipeLibraryService.getRecipeById(recipeId);
      if (recipe && this.selectedRecipeId() === recipeId) {
        this.likeCount.set(recipe.likes);
      }
    } catch (error) {
      console.error('Failed to load current like count:', error);
    }
  }

  /**
   * Loads and selects a cookbook recipe by its Firebase id.
   * @param recipeId Firebase id from the route.
   * @returns A promise that resolves when the recipe was loaded or failed.
   */
  private async selectCookbookRecipeFromRoute(recipeId: string) {
    this.selectedRecipeId.set(recipeId);
    this.likeCount.set(null);
    this.likeState.set('idle');
    this.isLoadingRecipe.set(true);

    try {
      const recipe = await this.recipeLibraryService.getRecipeById(recipeId);
      if (!recipe) {
        this.selectedRecipe.set(null);
        return;
      }

      this.selectedRecipe.set(this.toRecipe(recipe));
      this.requestPayload.set(this.toRequestPayload(recipe));
    } catch (error) {
      console.error('Failed to load cookbook recipe details:', error);
      this.selectedRecipe.set(null);
    } finally {
      this.isLoadingRecipe.set(false);
    }
  }

  /**
   * Converts a cookbook record into the recipe shown on this page.
   * @param recipe Validated cookbook record.
   * @returns The recipe including optional new-contract fields.
   */
  private toRecipe(recipe: CookbookRecipeRecord): Recipe {
    return {
      title: recipe.title,
      description: recipe.description,
      estimatedMinutes: recipe.estimatedMinutes,
      ingredients: recipe.ingredients,
      steps: recipe.steps,
      extraIngredients: recipe.extraIngredients,
      stepDetails: recipe.stepDetails,
      nutrition: recipe.nutrition,
      ingredientCoverage: recipe.ingredientCoverage,
      likes: recipe.likes,
    };
  }

  /**
   * Rebuilds the request payload of a cookbook record.
   * @param recipe Validated cookbook record.
   * @returns The request payload with ingredients and preferences.
   */
  private toRequestPayload(recipe: CookbookRecipeRecord): RecipeRequestPayload {
    return {
      ingredients: recipe.sourceIngredients,
      preferences: {
        portions: recipe.portions,
        cooks: recipe.cooks,
        cookingTime: recipe.cookingTime,
        cuisine: recipe.cuisine,
        diets: recipe.diets.length > 0 ? recipe.diets : ['none'],
      },
    };
  }

  /**
   * Adds a like to the selected recipe once per browser.
   * @returns A promise that resolves when the like was saved or failed.
   */
  async likeRecipe() {
    const recipeId = this.selectedRecipeId();
    if (!recipeId || this.isLikedByUser() || this.likeState() === 'saving') {
      return;
    }

    this.likeState.set('saving');

    try {
      const updatedLikes = await this.recipeLibraryService.incrementRecipeLike(recipeId);
      this.likeCount.set(updatedLikes);
      this.likedRecipeIds.update((ids) => [...ids, recipeId]);
      this.persistLikedRecipeIds();
      this.likeState.set('saved');
    } catch (error) {
      console.error('Unable to like recipe:', error);
      this.likeState.set('error');
    }
  }

  /**
   * Reads the stored request payload from localStorage.
   */
  private loadRequestPayload() {
    const raw = localStorage.getItem(this.requestKey);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as RecipeRequestPayload;
      if (parsed && parsed.preferences && Array.isArray(parsed.ingredients)) {
        this.requestPayload.set(parsed);
      }
    } catch (error) {
      console.error('Failed to parse request payload:', error);
    }
  }

  /**
   * Reads and parses the stored webhook response from localStorage.
   */
  private loadRecipes() {
    const raw = localStorage.getItem(this.responseKey);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      const candidate = extractResult(parsed);
      const recipes = parseRecipeArray(candidate);
      this.recipes.set(recipes);
    } catch (error) {
      console.error('Failed to parse recipe response:', error);
    }
  }

  /**
   * Reads the Firebase ids of the current results from localStorage.
   */
  private loadSavedRecipeIds() {
    const raw = localStorage.getItem(this.savedRecipeIdsKey);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
        this.savedRecipeIds.set(parsed);
      }
    } catch (error) {
      console.error('Failed to parse saved recipe ids:', error);
    }
  }

  /**
   * Reads the ids of recipes liked in this browser from localStorage.
   */
  private loadLikedRecipeIds() {
    const raw = localStorage.getItem(this.likedRecipeIdsKey);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
        this.likedRecipeIds.set(parsed);
      }
    } catch (error) {
      console.error('Failed to parse liked recipe ids:', error);
    }
  }

  /**
   * Writes the liked recipe ids to localStorage.
   */
  private persistLikedRecipeIds() {
    localStorage.setItem(this.likedRecipeIdsKey, JSON.stringify(this.likedRecipeIds()));
  }

  /**
   * Expands or collapses the ingredient lists (mobile and tablet) and scrolls them into view when opened.
   * @param panel The ingredient lists element.
   */
  showIngredients(panel?: HTMLElement) {
    this.ingredientsExpanded.update((expanded) => !expanded);
    this.scrollIntoViewWhenExpanded(this.ingredientsExpanded(), panel);
  }

  /**
   * Expands or collapses the directions (mobile and tablet) and scrolls them into view when opened.
   * @param panel The directions element.
   */
  showDirections(panel?: HTMLElement) {
    this.directionsExpanded.update((expanded) => !expanded);
    this.scrollIntoViewWhenExpanded(this.directionsExpanded(), panel);
  }

  /**
   * Scrolls an element into view after it has been rendered visible.
   * @param expanded Whether the element was just expanded.
   * @param panel The element to scroll to.
   */
  private scrollIntoViewWhenExpanded(expanded: boolean, panel?: HTMLElement) {
    if (!expanded || !panel) {
      return;
    }

    requestAnimationFrame(() => panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }
}
