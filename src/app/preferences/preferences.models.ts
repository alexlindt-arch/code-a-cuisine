export type CookingTimeId = 'quick' | 'medium' | 'complex';
export type CuisineId = 'german' | 'italian' | 'indian' | 'japanese' | 'gourmet' | 'fusion';
export type DietId = 'vegetarian' | 'vegan' | 'keto' | 'none';

export interface CookingTimeOption {
  id: CookingTimeId;
  label: string;
  hint: string;
}

export interface Option<T extends string> {
  id: T;
  label: string;
}

export interface StoredIngredient {
  name: string;
  quantity: number;
  unit: string;
}

export interface StoredRecipeContext {
  ingredients: StoredIngredient[];
  preferences?: {
    portions: number;
    cooks: number;
    cookingTime: CookingTimeId;
    cuisine: CuisineId;
    diets: DietId[];
  };
}

export interface RecipeRequestPayload {
  ingredients: StoredIngredient[];
  preferences: {
    portions: number;
    cooks: number;
    cookingTime: CookingTimeId;
    cuisine: CuisineId;
    diets: DietId[];
  };
  clientIp: string;
  requestedAt: string;
}

export interface QuotaStatus {
  date: string;
  ipAddress: string;
  ipVersion: 'ipv4' | 'ipv6' | 'unknown';
  perIpLimit: number;
  perIpUsed: number;
  perIpRemaining: number;
  globalLimit: number;
  globalUsed: number;
  globalRemaining: number;
}

export interface RecipeResponsePayload {
  result?: unknown;
  quota?: QuotaStatus;
}

/** Macro nutrients of a recipe: energy in kcal, protein/carbs/fat in grams. */
export interface RecipeMacros {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

/** Nutrition values of a recipe for one portion and for the whole recipe. */
export interface RecipeNutrition {
  perPortion: RecipeMacros;
  total: RecipeMacros;
}

/** One structured cooking step, assigned to a cook (1..cooks). */
export interface RecipeStepDetail {
  title: string;
  instruction: string;
  cook: number;
  parallel: boolean;
  durationMinutes: number;
}

/** A recipe exactly as returned by the n8n webhook (new response contract). */
export interface GeneratedRecipe {
  title: string;
  description: string;
  estimatedMinutes: number;
  /** The available ingredients the recipe uses (at least 70 %, enforced by the workflow schema). */
  usedIngredients: string[];
  ingredients: string[];
  extraIngredients: string[];
  steps: string[];
  stepDetails: RecipeStepDetail[];
  nutrition: RecipeNutrition;
  ingredientCoverage: number;
}

/** Successful (HTTP 200) response body of the recipe generation webhook. */
export interface RecipeGenerationSuccessResponse {
  request: {
    ingredients: StoredIngredient[];
    preferences: RecipeRequestPayload['preferences'];
  };
  generatedAt: string;
  quota: QuotaStatus;
  result: {
    recipes: GeneratedRecipe[];
  };
}

/** Error response body of the recipe generation webhook (HTTP 400, 429 or 500). */
export interface RecipeGenerationErrorResponse {
  message: string;
  /** For example 'INVALID_REQUEST' (400) or 'RECIPE_GENERATION_FAILED' (500). */
  code: string;
  errors?: string[];
  quota?: QuotaStatus;
}

export interface QuotaResponsePayload {
  message?: string;
  quota?: QuotaStatus;
}

export interface LocalIpQuotaWindowRecord {
  ipAddress: string;
  ipVersion: 'ipv4' | 'ipv6' | 'unknown';
  timestamps: number[];
}

export interface LocalQuotaWindowStore {
  records: LocalIpQuotaWindowRecord[];
}

export interface QuotaCardSummary {
  show: boolean;
  kind: 'none' | 'local' | 'remote';
  localUsage: number;
  perIpRemaining: number | null;
  globalRemaining: number | null;
  message: string | null;
}
