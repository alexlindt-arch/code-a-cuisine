/**
 * @file generate-recipe.utils.ts
 * @description Pure helpers for ingredient validation, unit handling and the stored recipe context.
 */

/** Unit ids accepted by the recipe webhook (anything else is rejected with HTTP 400). */
export type IngredientUnitId = 'gram' | 'kg' | 'ml' | 'liter' | 'piece';

/** A selectable unit with its short display label. */
export interface IngredientUnitOption {
  id: IngredientUnitId;
  label: string;
}

export interface RecipeIngredient {
  name: string;
  quantity: number;
  unit: IngredientUnitId;
}

export interface StoredRecipeContext {
  ingredients: RecipeIngredient[];
  preferences?: {
    portions: number;
    cooks: number;
    cookingTime: 'quick' | 'medium' | 'complex';
    cuisine: string;
    diets: string[];
  };
}

/** All units offered in the ingredient form, in display order. */
export const INGREDIENT_UNIT_OPTIONS: readonly IngredientUnitOption[] = [
  { id: 'gram', label: 'g' },
  { id: 'kg', label: 'kg' },
  { id: 'ml', label: 'ml' },
  { id: 'liter', label: 'l' },
  { id: 'piece', label: 'pcs' },
];

/** Legacy or shorthand unit spellings mapped to the server unit ids. */
const UNIT_ALIASES: Record<string, IngredientUnitId> = {
  g: 'gram',
  gram: 'gram',
  grams: 'gram',
  kg: 'kg',
  ml: 'ml',
  l: 'liter',
  liter: 'liter',
  liters: 'liter',
  litre: 'liter',
  piece: 'piece',
  pieces: 'piece',
  pcs: 'piece',
};

/**
 * Removes markup characters, control whitespace and duplicate spaces from an ingredient name.
 * @param value - Raw user input.
 * @returns The trimmed, sanitized name.
 */
export function sanitizeIngredientName(value: string): string {
  return value
    .trim()
    .replace(/[<>]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ');
}

/**
 * Checks whether an ingredient name is non-empty, short enough and matches the allowed characters.
 * @param value - Name to validate.
 * @param pattern - Allowed character pattern.
 * @param maxLength - Maximum number of characters.
 * @returns True when the name is valid.
 */
export function isValidIngredientName(
  value: string,
  pattern: RegExp,
  maxLength: number
): boolean {
  const trimmedValue = value.trim();
  return trimmedValue.length > 0
    && trimmedValue.length <= maxLength
    && pattern.test(trimmedValue);
}

/**
 * Checks whether a quantity can be sent to the server (finite and greater than 0).
 * @param quantity - Quantity to validate.
 * @returns True when the quantity is valid.
 */
export function isValidQuantity(quantity: number): boolean {
  return Number.isFinite(quantity) && quantity > 0;
}

/**
 * Type guard for the unit ids accepted by the server.
 * @param unit - Value to check.
 * @returns True when the value is a known unit id.
 */
export function isIngredientUnitId(unit: unknown): unit is IngredientUnitId {
  return INGREDIENT_UNIT_OPTIONS.some((option) => option.id === unit);
}

/**
 * Maps a stored or legacy unit spelling to a server unit id.
 * @param unit - Unit as stored (for example 'g' or 'gram').
 * @returns The matching unit id, or 'piece' when the unit is unknown.
 */
export function normalizeIngredientUnit(unit: string): IngredientUnitId {
  return UNIT_ALIASES[unit.trim().toLowerCase()] ?? 'piece';
}

/**
 * Returns the short display label of a unit.
 * @param unit - Unit id or legacy unit spelling.
 * @returns The label, for example 'g' for 'gram'.
 */
export function getUnitLabel(unit: string): string {
  const unitId = normalizeIngredientUnit(unit);
  return INGREDIENT_UNIT_OPTIONS.find((option) => option.id === unitId)?.label ?? unit;
}

/**
 * Checks whether a value has the basic shape of a stored ingredient.
 * @param value - Parsed JSON value.
 * @returns True when name, quantity and unit have the expected types.
 */
export function isValidIngredient(value: unknown): value is RecipeIngredient {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const ingredient = value as Partial<RecipeIngredient>;
  return typeof ingredient.name === 'string'
    && typeof ingredient.quantity === 'number'
    && typeof ingredient.unit === 'string';
}

/**
 * Checks whether a value has the shape of a stored recipe context.
 * @param value - Parsed JSON value.
 * @returns True when the value contains a valid ingredient array.
 */
export function isStoredRecipeContext(value: unknown): value is StoredRecipeContext {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const context = value as Partial<StoredRecipeContext>;
  return Array.isArray(context.ingredients)
    && context.ingredients.every(isValidIngredient);
}

/** localStorage key of the recipe context (ingredient list and preferences). */
export const RECIPE_CONTEXT_STORAGE_KEY = 'cac-ingredients';

/**
 * Reads the recipe context from localStorage, accepting the legacy plain-array format.
 * Units are normalized to the ids the server accepts.
 * @param storageKey - localStorage key of the context.
 * @returns The stored context, or an empty context when nothing valid is stored.
 */
export function readStoredRecipeContext(storageKey: string): StoredRecipeContext {
  const storedValue = localStorage.getItem(storageKey);
  if (!storedValue) {
    return { ingredients: [] };
  }

  try {
    const parsed = JSON.parse(storedValue) as unknown;
    if (Array.isArray(parsed) && parsed.every(isValidIngredient)) {
      return { ingredients: normalizeIngredients(parsed) };
    }

    return isStoredRecipeContext(parsed)
      ? { ...parsed, ingredients: normalizeIngredients(parsed.ingredients) }
      : { ingredients: [] };
  } catch (error) {
    console.error('Unable to parse stored recipe context:', error);
    return { ingredients: [] };
  }
}

/**
 * Reads only the ingredient list of the stored recipe context.
 * @param storageKey - localStorage key of the context.
 * @returns The stored ingredients (possibly empty).
 */
export function readStoredIngredients(storageKey: string): RecipeIngredient[] {
  return readStoredRecipeContext(storageKey).ingredients;
}

/**
 * Empties the stored ingredient list while keeping the rest of the recipe context.
 * Called once a recipe generation has succeeded, so that opening the generate recipe page
 * again starts with an empty list instead of the ingredients that were already used.
 * @param storageKey - localStorage key of the context.
 */
export function clearStoredIngredients(storageKey: string): void {
  const context = readStoredRecipeContext(storageKey);
  localStorage.setItem(storageKey, JSON.stringify({ ...context, ingredients: [] }));
}

/**
 * Converts an ingredient name into a Firebase-safe key.
 * @param name - Ingredient name.
 * @returns A lowercase slug, or 'ingredient' when nothing usable remains.
 */
export function toIngredientSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'ingredient';
}

/**
 * Normalizes the unit of every ingredient to a server unit id.
 * @param ingredients - Ingredients as stored.
 * @returns New ingredient objects with normalized units.
 */
function normalizeIngredients(ingredients: RecipeIngredient[]): RecipeIngredient[] {
  return ingredients.map((ingredient) => ({
    ...ingredient,
    unit: normalizeIngredientUnit(ingredient.unit),
  }));
}
