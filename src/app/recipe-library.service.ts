/**
 * @file recipe-library.service.ts
 * @description Stores generated recipes in the Firebase Realtime Database and reads them back for the cookbook.
 */
import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../environments/environment';
import type { RecipeNutrition, RecipeStepDetail } from './preferences/preferences.models';
import { parseStringArray, readOptionalRecipeFields, type OptionalRecipeFields } from './recipe-detail/recipe-detail.utils';
import { findSeedRecipe, isSeedRecipeId, mergeWithSeedRecipes } from './cookbook/seed-recipes';

/**
 * An ingredient as entered by the user.
 */
export interface StoredRecipeIngredient {
  name: string;
  quantity: number;
  unit: string;
}

/**
 * The request payload stored in localStorage when recipes are generated.
 */
export interface StoredRecipeRequestPayload {
  ingredients: StoredRecipeIngredient[];
  preferences: {
    portions: number;
    cooks: number;
    cookingTime: string;
    cuisine: string;
    diets: string[];
  };
  requestedAt: string;
}

/**
 * A generated recipe as parsed from the webhook response.
 * The optional fields are only present for recipes of the new response contract.
 */
export interface StoredRecipeResult {
  title: string;
  description: string;
  estimatedMinutes: number;
  ingredients: string[];
  steps: string[];
  extraIngredients?: string[];
  stepDetails?: RecipeStepDetail[];
  nutrition?: RecipeNutrition;
  ingredientCoverage?: number;
}

/**
 * A recipe record as written to Firebase.
 */
export interface FirebaseRecipeRecord {
  title: string;
  description: string;
  estimatedMinutes: number;
  ingredients: string[];
  steps: string[];
  extraIngredients?: string[];
  stepDetails?: RecipeStepDetail[];
  nutrition?: RecipeNutrition;
  ingredientCoverage?: number;
  cuisine: string;
  categorySlug: string;
  cookingTime: string;
  difficulty: 'Quick' | 'Medium' | 'Complex';
  dietLabel: string | null;
  diets: string[];
  cooks: number;
  portions: number;
  likes: number;
  createdAt: string;
  requestedAt: string;
  sourceIngredients: StoredRecipeIngredient[];
}

/**
 * A validated recipe record read from Firebase, including its database id.
 */
export interface CookbookRecipeRecord {
  id: string;
  title: string;
  description: string;
  estimatedMinutes: number;
  ingredients: string[];
  steps: string[];
  extraIngredients?: string[];
  stepDetails?: RecipeStepDetail[];
  nutrition?: RecipeNutrition;
  ingredientCoverage?: number;
  cuisine: string;
  categorySlug: string;
  cookingTime: string;
  difficulty: 'Quick' | 'Medium' | 'Complex';
  dietLabel: string | null;
  diets: string[];
  cooks: number;
  portions: number;
  likes: number;
  createdAt: string;
  requestedAt: string;
  sourceIngredients: StoredRecipeIngredient[];
}

type FirebaseRecipesResponse = Record<string, Partial<FirebaseRecipeRecord>>;

@Injectable({ providedIn: 'root' })
/**
 * Saves generated recipes to Firebase and loads, validates and likes cookbook recipes.
 */
export class RecipeLibraryService {
  private readonly http = inject(HttpClient);
  private readonly databaseUrl = environment.firebaseDatabaseUrl;
  /**
   * Likes given to preinstalled recipes in this browser session.
   * Preinstalled recipes never reach Firebase, so their likes cannot be stored there either.
   */
  private readonly seedLikes = new Map<string, number>();

  /**
   * Saves each generated recipe as a new record in Firebase.
   * @param recipes The parsed recipes of one generation request.
   * @param requestPayload The request (ingredients and preferences) that produced the recipes.
   * @returns The Firebase ids of the saved recipes, in the same order.
   */
  async saveGeneratedRecipes(recipes: StoredRecipeResult[], requestPayload: StoredRecipeRequestPayload): Promise<string[]> {
    const records = recipes.map((recipe) => this.toFirebaseRecord(recipe, requestPayload));
    const ids: string[] = [];

    for (const record of records) {
      const response = await firstValueFrom(this.http.post<{ name: string }>(`${this.databaseUrl}/recipes.json`, record));
      if (response?.name) {
        ids.push(response.name);
      }
    }

    return ids;
  }

  /**
   * Increments the like counter of a recipe.
   * @param recipeId Firebase id of the recipe.
   * @returns The new like count.
   */
  async incrementRecipeLike(recipeId: string): Promise<number> {
    if (isSeedRecipeId(recipeId)) {
      return this.incrementSeedRecipeLike(recipeId);
    }

    const likesUrl = `${this.databaseUrl}/recipes/${recipeId}/likes.json`;
    const currentLikes = await firstValueFrom(this.http.get<number | null>(likesUrl));
    const nextLikes = (typeof currentLikes === 'number' ? currentLikes : 0) + 1;
    await firstValueFrom(this.http.put<number>(likesUrl, nextLikes));
    return nextLikes;
  }

  /** True when the last database read failed and only the preinstalled recipes are shown. */
  readonly databaseUnavailable = signal(false);

  /**
   * Loads all valid recipes from Firebase and adds the preinstalled recipes, newest first.
   * The preinstalled recipes are merged in memory only, so they are never stored in the database
   * and cannot pile up over repeated loads.
   * @returns The validated cookbook recipes plus the preinstalled ones.
   */
  async getAllRecipes(): Promise<CookbookRecipeRecord[]> {
    const storedRecipes = await this.loadStoredRecipes();

    return mergeWithSeedRecipes(storedRecipes)
      .map((recipe) => this.withSeedLikes(recipe))
      .sort((firstRecipe, secondRecipe) => {
        const firstDate = Date.parse(firstRecipe.createdAt);
        const secondDate = Date.parse(secondRecipe.createdAt);
        return secondDate - firstDate;
      });
  }

  /**
   * Reads and validates the recipes stored in Firebase.
   * A failing request is logged and treated like an empty database, so the cookbook keeps
   * showing the preinstalled recipes while Firebase is unreachable.
   * @returns The validated recipes, or an empty list when the database is empty or unreachable.
   */
  private async loadStoredRecipes(): Promise<CookbookRecipeRecord[]> {
    try {
      const response = await firstValueFrom(this.http.get<FirebaseRecipesResponse | null>(`${this.databaseUrl}/recipes.json`));
      this.databaseUnavailable.set(false);
      if (!response) {
        return [];
      }

      return Object.entries(response)
        .map(([id, recipe]) => this.toCookbookRecipeRecord(id, recipe))
        .filter((recipe): recipe is CookbookRecipeRecord => recipe !== null);
    } catch (error) {
      console.error('Failed to load recipes from Firebase, showing the preinstalled recipes only:', error);
      this.databaseUnavailable.set(true);
      return [];
    }
  }

  /**
   * Loads a single recipe. Preinstalled recipes are resolved from the local seed list,
   * every other id is read from Firebase.
   * @param recipeId Firebase id, or id of a preinstalled recipe.
   * @returns The validated recipe, or null when it does not exist or is invalid.
   */
  async getRecipeById(recipeId: string): Promise<CookbookRecipeRecord | null> {
    const seedRecipe = findSeedRecipe(recipeId);
    if (seedRecipe) {
      return this.withSeedLikes(seedRecipe);
    }

    const response = await firstValueFrom(this.http.get<Partial<FirebaseRecipeRecord> | null>(`${this.databaseUrl}/recipes/${recipeId}.json`));
    if (!response) {
      return null;
    }

    return this.toCookbookRecipeRecord(recipeId, response);
  }

  /**
   * Counts a like of a preinstalled recipe in memory instead of writing it to Firebase.
   * @param recipeId Id of the preinstalled recipe.
   * @returns The new like count for this browser session.
   */
  private incrementSeedRecipeLike(recipeId: string): number {
    const currentLikes = this.seedLikes.get(recipeId) ?? findSeedRecipe(recipeId)?.likes ?? 0;
    const nextLikes = currentLikes + 1;
    this.seedLikes.set(recipeId, nextLikes);
    return nextLikes;
  }

  /**
   * Applies the likes a preinstalled recipe collected in this session.
   * @param recipe A cookbook recipe, preinstalled or loaded from Firebase.
   * @returns The recipe with its current like count.
   */
  private withSeedLikes(recipe: CookbookRecipeRecord): CookbookRecipeRecord {
    const likes = this.seedLikes.get(recipe.id);
    return typeof likes === 'number' ? { ...recipe, likes } : recipe;
  }

  /**
   * Builds the Firebase record of a generated recipe, including the optional new-contract fields.
   * @param recipe The generated recipe.
   * @param requestPayload The request that produced the recipe.
   * @returns The record to store.
   */
  private toFirebaseRecord(recipe: StoredRecipeResult, requestPayload: StoredRecipeRequestPayload): FirebaseRecipeRecord {
    const cuisine = requestPayload.preferences.cuisine;
    const diets = requestPayload.preferences.diets.filter((diet) => diet !== 'none');

    return {
      title: recipe.title,
      description: recipe.description,
      estimatedMinutes: recipe.estimatedMinutes,
      ingredients: recipe.ingredients,
      steps: recipe.steps,
      ...readOptionalRecipeFields(recipe as unknown as Record<string, unknown>),
      cuisine,
      categorySlug: this.toCategorySlug(cuisine),
      cookingTime: requestPayload.preferences.cookingTime,
      difficulty: this.toDifficulty(recipe.estimatedMinutes, requestPayload.preferences.cookingTime),
      dietLabel: diets[0] ?? null,
      diets,
      cooks: requestPayload.preferences.cooks,
      portions: requestPayload.preferences.portions,
      likes: 0,
      createdAt: new Date().toISOString(),
      requestedAt: requestPayload.requestedAt,
      sourceIngredients: requestPayload.ingredients,
    };
  }

  /**
   * Maps a cuisine id or label to its cookbook category.
   * @param cuisine Cuisine id (e.g. "italian") or label (e.g. "Italian").
   * @returns The category slug; "Fusion" for unknown cuisines.
   */
  private toCategorySlug(cuisine: string): string {
    const normalizedCuisine = cuisine.trim().toLowerCase();
    const categories = ['German', 'Italian', 'Indian', 'Japanese', 'Gourmet', 'Fusion'];
    return categories.find((category) => normalizedCuisine.includes(category.toLowerCase())) ?? 'Fusion';
  }

  /**
   * Derives the difficulty label from the cooking time.
   * @param minutes Estimated cooking time in minutes.
   * @param fallback Cooking time preference used for recipes longer than 40 minutes.
   * @returns The difficulty label.
   */
  private toDifficulty(minutes: number, fallback: string): 'Quick' | 'Medium' | 'Complex' {
    if (minutes <= 20) {
      return 'Quick';
    }

    if (minutes <= 40) {
      return 'Medium';
    }

    const normalizedFallback = fallback.trim();
    if (normalizedFallback === 'quick') {
      return 'Quick';
    }

    if (normalizedFallback === 'complex') {
      return 'Complex';
    }

    return 'Medium';
  }

  /**
   * Validates a raw Firebase record and converts it into a cookbook recipe.
   * @param id Firebase id of the record.
   * @param recipe Raw record data (types are not trusted).
   * @returns The cookbook recipe, or null when required fields are missing or invalid.
   */
  private toCookbookRecipeRecord(id: string, recipe: Partial<FirebaseRecipeRecord>): CookbookRecipeRecord | null {
    const estimatedMinutes = this.toNumber(recipe.estimatedMinutes);
    const cooks = this.toNumber(recipe.cooks);
    const portions = this.toNumber(recipe.portions);
    const likes = this.toNumber(recipe.likes) ?? 0;

    const cuisine = typeof recipe.cuisine === 'string' ? recipe.cuisine : '';
    const categorySlug = typeof recipe.categorySlug === 'string' && recipe.categorySlug.trim()
      ? recipe.categorySlug
      : this.toCategorySlug(cuisine);

    const requestedAt = typeof recipe.requestedAt === 'string' && recipe.requestedAt.trim()
      ? recipe.requestedAt
      : (typeof recipe.createdAt === 'string' && recipe.createdAt.trim() ? recipe.createdAt : new Date().toISOString());

    const createdAt = typeof recipe.createdAt === 'string' && recipe.createdAt.trim()
      ? recipe.createdAt
      : requestedAt;

    const diets = Array.isArray(recipe.diets)
      ? recipe.diets.filter((diet): diet is string => typeof diet === 'string')
      : [];

    const sourceIngredients = Array.isArray(recipe.sourceIngredients)
      ? recipe.sourceIngredients.filter((ingredient): ingredient is StoredRecipeIngredient => (
        typeof ingredient === 'object'
        && ingredient !== null
        && typeof ingredient.name === 'string'
        && typeof ingredient.quantity === 'number'
        && Number.isFinite(ingredient.quantity)
        && typeof ingredient.unit === 'string'
      ))
      : [];

    const cookingTime = typeof recipe.cookingTime === 'string' && recipe.cookingTime.trim()
      ? recipe.cookingTime
      : this.toCookingTimeFallback(estimatedMinutes);

    const ingredients = parseStringArray(recipe.ingredients);
    const steps = parseStringArray(recipe.steps);
    const resolvedCooks = typeof cooks === 'number' ? cooks : 1;
    const resolvedPortions = typeof portions === 'number' ? portions : 1;

    if (typeof recipe.title !== 'string'
      || typeof recipe.description !== 'string'
      || typeof estimatedMinutes !== 'number'
      || !ingredients
      || !steps
      || !cuisine
      || !categorySlug
      || !cookingTime) {
      return null;
    }

    return {
      id,
      title: recipe.title,
      description: recipe.description,
      estimatedMinutes,
      ingredients,
      steps,
      ...this.readStoredOptionalFields(recipe),
      cuisine,
      categorySlug,
      cookingTime,
      difficulty: recipe.difficulty === 'Quick' || recipe.difficulty === 'Medium' || recipe.difficulty === 'Complex'
        ? recipe.difficulty
        : this.toDifficulty(estimatedMinutes, cookingTime),
      dietLabel: typeof recipe.dietLabel === 'string' ? recipe.dietLabel : null,
      diets,
      cooks: resolvedCooks,
      portions: resolvedPortions,
      likes,
      createdAt,
      requestedAt,
      sourceIngredients,
    };
  }

  /**
   * Reads the optional new-contract fields of a stored record.
   * Firebase drops empty arrays, so a new-format record (with step details or nutrition)
   * without extraIngredients is treated as having no extra ingredients.
   * @param recipe Raw record data.
   * @returns The valid optional fields.
   */
  private readStoredOptionalFields(recipe: Partial<FirebaseRecipeRecord>): OptionalRecipeFields {
    const fields = readOptionalRecipeFields(recipe as unknown as Record<string, unknown>);
    const isNewFormat = Boolean(fields.stepDetails || fields.nutrition || typeof fields.ingredientCoverage === 'number');

    if (!fields.extraIngredients && isNewFormat) {
      fields.extraIngredients = [];
    }

    return fields;
  }

  /**
   * Derives a cooking time label when a record has none.
   * @param estimatedMinutes Estimated cooking time in minutes, if known.
   * @returns "Quick", "Medium" or "Complex".
   */
  private toCookingTimeFallback(estimatedMinutes: number | null): string {
    if (typeof estimatedMinutes !== 'number') {
      return 'Medium';
    }

    if (estimatedMinutes <= 20) {
      return 'Quick';
    }

    if (estimatedMinutes <= 40) {
      return 'Medium';
    }

    return 'Complex';
  }

  /**
   * Converts a number or numeric string into a finite number.
   * @param value Unknown value.
   * @returns The number, or null when it is not a finite number.
   */
  private toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }
}
