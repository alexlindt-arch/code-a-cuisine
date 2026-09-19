/**
 * @file recipe-detail.utils.ts
 * @description Pure helpers to parse, validate and prepare generated recipes for display.
 */
import type { RecipeMacros, RecipeNutrition, RecipeStepDetail } from '../preferences/preferences.models';

/** Title and description of one step, derived from a plain step string. */
export interface RecipeStepView {
  title: string;
  description: string;
}

/**
 * Normalized recipe used across results, detail page and cookbook storage.
 * The optional fields only exist for recipes generated with the new n8n response contract.
 */
export interface RecipeShape {
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

/** The optional fields of the new response contract. */
export type OptionalRecipeFields = Pick<RecipeShape, 'extraIngredients' | 'stepDetails' | 'nutrition' | 'ingredientCoverage'>;

/** One step inside a cook's to-do list, numbered in global chronological order. */
export interface CookStepView {
  number: number;
  title: string;
  instruction: string;
  parallel: boolean;
  durationMinutes: number;
}

/** The to-do list of a single cook. */
export interface CookTodoList {
  cook: number;
  iconSrc: string;
  steps: CookStepView[];
}

/** Supported keys of the macro nutrient breakdown. */
export type MacroKey = 'protein' | 'carbs' | 'fat';

/** One macro nutrient row with grams, energy and its share of the macro energy sum. */
export interface MacroRow {
  key: MacroKey;
  /** Text key of the nutrient name (e.g. 'detail.protein'). */
  label: string;
  grams: number;
  kcal: number;
  percent: number;
}

/** Number of distinct cook icons that exist in assets/icons. */
export const COOK_ICON_COUNT = 3;

/** Energy per gram for each macro nutrient in kcal. */
export const KCAL_PER_GRAM: Record<MacroKey, number> = {
  protein: 4,
  carbs: 4,
  fat: 9,
};

/** Text keys of the macro nutrient names, translated in the template. */
const macroLabels: Record<MacroKey, string> = {
  protein: 'detail.protein',
  carbs: 'detail.carbs',
  fat: 'detail.fat',
};

const ingredientSynonymGroups = [
  ['apple', 'apfel', 'apples', 'aepfel'],
  ['applesauce', 'apfelmus', 'apple sauce', 'apfel sosse'],
  ['basil', 'basilikum'],
  ['butter', 'butterschmalz'],
  ['cinnamon', 'zimt'],
  ['chicken', 'chicken breast', 'huhn', 'huehnchen', 'huehnchenbrust', 'huhnerbrust', 'hahnchen', 'hahnchenbrust', 'haehnchen', 'haehnchenbrust'],
  ['flour', 'mehl'],
  ['garlic', 'knoblauch'],
  ['milk', 'milch'],
  ['mozzarella'],
  ['onion', 'zwiebel'],
  ['rice pudding', 'milchreis'],
  ['rice', 'reis'],
  ['salt', 'salz'],
  ['sugar', 'zucker'],
  ['tomato', 'tomatoes', 'tomate', 'tomaten'],
];

/**
 * Normalizes an ingredient string for fuzzy matching (strips accents, leading amounts, units and plural "s").
 * @param value Raw ingredient text, e.g. "200 g Tomatoes".
 * @returns The normalized name, e.g. "tomatoe".
 */
export function normalizeIngredientName(value: string): string {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^\s*\d+(?:[.,]\d+)?\s*(?:g|gram|grams|kg|ml|l|liter|liters|piece|pieces|stk|stuck)\s+/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  return normalized.endsWith('s') && !normalized.endsWith('ss')
    ? normalized.slice(0, -1)
    : normalized;
}

/**
 * Checks whether a generated ingredient corresponds to an ingredient the user requested.
 * @param generatedIngredient Ingredient text from the generated recipe.
 * @param requestedName Already normalized name of a requested ingredient.
 * @returns True when both refer to the same ingredient (including known synonyms).
 */
export function ingredientsMatch(generatedIngredient: string, requestedName: string): boolean {
  const generatedVariants = getIngredientVariants(normalizeIngredientName(generatedIngredient));
  const requestedVariants = getIngredientVariants(requestedName);

  return generatedVariants.some((generatedVariant) => requestedVariants.some((requestedVariant) =>
    generatedVariant === requestedVariant
    || generatedVariant.includes(requestedVariant)
    || requestedVariant.includes(generatedVariant)
  ));
}

/**
 * Looks up the synonym group of a normalized ingredient name.
 * @param value Normalized ingredient name.
 * @returns All known synonyms, or just the value itself.
 */
function getIngredientVariants(value: string): string[] {
  const matchingGroup = ingredientSynonymGroups.find((group) =>
    group.some((synonym) => value === synonym || value.includes(synonym) || synonym.includes(value))
  );

  return matchingGroup ?? [value];
}

/**
 * Splits a recipe's ingredients into the user's own ingredients and extra ingredients.
 * Uses the explicit extraIngredients list when available, otherwise falls back to name matching.
 * @param recipe The recipe to split.
 * @param requestedIngredientNames Names of the ingredients the user entered.
 * @returns The user's ingredients and the extra ingredients.
 */
export function splitIngredients(
  recipe: Pick<RecipeShape, 'ingredients' | 'extraIngredients'>,
  requestedIngredientNames: string[],
): { yours: string[]; extras: string[] } {
  if (recipe.extraIngredients) {
    const extraKeys = new Set(recipe.extraIngredients.map(toComparableText));
    return {
      yours: recipe.ingredients.filter((ingredient) => !extraKeys.has(toComparableText(ingredient))),
      extras: recipe.extraIngredients,
    };
  }

  const requestedNames = requestedIngredientNames.map(normalizeIngredientName);
  const isRequested = (ingredient: string) =>
    requestedNames.some((requestedName) => ingredientsMatch(ingredient, requestedName));

  return {
    yours: recipe.ingredients.filter(isRequested),
    extras: recipe.ingredients.filter((ingredient) => !isRequested(ingredient)),
  };
}

/**
 * Reduces a text to a case- and whitespace-insensitive comparison key.
 * @param value Any text.
 * @returns Trimmed lower-case text with collapsed whitespace.
 */
function toComparableText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Converts a plain step string ("Title: instruction") into a title and a description.
 * @param raw The raw step text.
 * @param index Zero-based position of the step, used for fallback titles.
 * @returns The step view with title and description.
 */
export function toStepView(raw: string, index: number): RecipeStepView {
  const trimmed = raw.trim();
  const colonMatch = trimmed.match(/^([^:]{3,80}):\s+([\s\S]+)$/);
  if (colonMatch) {
    return {
      title: isGenericStepTitle(colonMatch[1].trim())
        ? buildStepTitleFromDescription(colonMatch[2].trim(), index)
        : colonMatch[1].trim(),
      description: colonMatch[2].trim(),
    };
  }

  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length > 1 && lines[0].length <= 80) {
    return {
      title: isGenericStepTitle(lines[0]) ? buildStepTitleFromDescription(lines.slice(1).join(' '), index) : lines[0],
      description: lines.slice(1).join(' '),
    };
  }

  const cleaned = stripGenericStepPrefix(trimmed);
  if (cleaned && cleaned !== trimmed) {
    return { title: buildStepTitleFromDescription(cleaned, index), description: cleaned };
  }

  return {
    title: isGenericStepTitle(trimmed) ? buildStepTitleFromDescription(trimmed, index) : `Step ${index + 1}`,
    description: trimmed,
  };
}

/**
 * Checks whether a title only says "Step N" / "Schritt N" without real content.
 * @param value Title candidate.
 * @returns True for generic step titles.
 */
function isGenericStepTitle(value: string): boolean {
  const compact = value.toLowerCase().replace(/[^a-z0-9]/g, '');
  return /^step\d*$/.test(compact) || /^schritt\d*$/.test(compact);
}

/**
 * Removes leading "Step 1:", "Schritt 2." or "3)" prefixes from a step text.
 * @param value Step text.
 * @returns The text without a generic prefix.
 */
function stripGenericStepPrefix(value: string): string {
  return value
    .replace(/^step\s*\d*\s*[:.)\-–—]*\s*/i, '')
    .replace(/^schritt\s*\d*\s*[:.)\-–—]*\s*/i, '')
    .replace(/^\d+\s*[:.)\-–—]+\s*/, '')
    .trim();
}

/**
 * Builds a short title from the first words of a step description.
 * @param description Step description.
 * @param index Zero-based step index used for the "Step N" fallback.
 * @returns A title with up to five capitalized words.
 */
function buildStepTitleFromDescription(description: string, index: number): string {
  const cleaned = stripGenericStepPrefix(description);
  if (!cleaned) {
    return `Step ${index + 1}`;
  }

  const titleWords = cleaned.split(/[.!?]/)[0]
    .replace(/[^A-Za-z0-9' -]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, 5);

  if (titleWords.length < 2) {
    return `Step ${index + 1}`;
  }

  return titleWords.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
}

/**
 * Unwraps the recipe container from a stored webhook response.
 * @param payload The parsed webhook response.
 * @returns The value of result/output/data/response, or the payload itself.
 */
export function extractResult(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null) {
    return payload;
  }

  const objectPayload = payload as Record<string, unknown>;
  return objectPayload['result'] ?? objectPayload['output'] ?? objectPayload['data'] ?? objectPayload['response'] ?? payload;
}

/**
 * Parses a list of recipes from an array, an object with a recipes array, or a JSON text.
 * @param input Unknown webhook result.
 * @returns All valid recipes including their optional new-contract fields.
 */
export function parseRecipeArray(input: unknown): RecipeShape[] {
  if (Array.isArray(input)) {
    return input.filter(isRecipe).map(toRecipeShape);
  }

  if (typeof input === 'string') {
    const parsed = tryParseFromText(input);
    return parsed ? parseRecipeArray(parsed) : [];
  }

  if (typeof input !== 'object' || input === null) {
    return [];
  }

  const objectInput = input as Record<string, any>;
  const recipes = objectInput['recipes']
    ?? objectInput['data']?.recipes
    ?? objectInput['output']?.recipes
    ?? objectInput['response']?.recipes;
  return Array.isArray(recipes) ? recipes.filter(isRecipe).map(toRecipeShape) : [];
}

/**
 * Copies the required fields of a validated recipe and adds the valid optional fields.
 * @param value A value that passed isRecipe.
 * @returns A clean recipe object without unknown properties.
 */
function toRecipeShape(value: RecipeShape): RecipeShape {
  return {
    title: value.title,
    description: value.description,
    estimatedMinutes: value.estimatedMinutes,
    ingredients: value.ingredients,
    steps: value.steps,
    ...readOptionalRecipeFields(value as unknown as Record<string, unknown>),
  };
}

/**
 * Reads and validates the optional fields of the new response contract.
 * Invalid or missing fields are left out so old recipes keep working.
 * @param source Raw recipe object (webhook response, localStorage or Firebase).
 * @returns Only the optional fields that are present and valid.
 */
export function readOptionalRecipeFields(source: Record<string, unknown>): OptionalRecipeFields {
  const fields: OptionalRecipeFields = {};
  const extraIngredients = parseStringArray(source['extraIngredients']);
  const stepDetails = parseStepDetails(source['stepDetails']);
  const nutrition = parseNutrition(source['nutrition']);
  const ingredientCoverage = parseIngredientCoverage(source['ingredientCoverage']);

  if (extraIngredients) {
    fields.extraIngredients = extraIngredients;
  }

  if (stepDetails) {
    fields.stepDetails = stepDetails;
  }

  if (nutrition) {
    fields.nutrition = nutrition;
  }

  if (typeof ingredientCoverage === 'number') {
    fields.ingredientCoverage = ingredientCoverage;
  }

  return fields;
}

/**
 * Parses an array of strings, dropping non-string entries.
 * @param value Unknown value.
 * @returns The trimmed non-empty strings, or undefined when the value is not an array.
 */
export function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Parses structured step details; invalid steps are skipped and missing flags get safe defaults.
 * @param value Unknown value.
 * @returns The valid step details, or undefined when none are valid.
 */
export function parseStepDetails(value: unknown): RecipeStepDetail[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const details = value
    .map((item, index) => parseStepDetail(item, index))
    .filter((item): item is RecipeStepDetail => item !== null);

  return details.length > 0 ? details : undefined;
}

/**
 * Parses a single structured step.
 * @param value Unknown step value.
 * @param index Zero-based step index, used for a fallback title.
 * @returns The step detail, or null when it has no instruction.
 */
function parseStepDetail(value: unknown, index: number): RecipeStepDetail | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const step = value as Record<string, unknown>;
  const instruction = typeof step['instruction'] === 'string' ? step['instruction'].trim() : '';
  if (!instruction) {
    return null;
  }

  const title = typeof step['title'] === 'string' && step['title'].trim() ? step['title'].trim() : `Step ${index + 1}`;
  const cook = toFiniteNumber(step['cook']);
  const duration = toFiniteNumber(step['durationMinutes']);

  return {
    title,
    instruction,
    cook: cook !== null && cook >= 1 ? Math.floor(cook) : 1,
    parallel: step['parallel'] === true,
    durationMinutes: duration !== null && duration > 0 ? Math.round(duration) : 0,
  };
}

/**
 * Parses per-portion and total nutrition values. Both must be valid, otherwise nothing is shown.
 * @param value Unknown value.
 * @returns The nutrition values, or undefined when incomplete or invalid.
 */
export function parseNutrition(value: unknown): RecipeNutrition | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const nutrition = value as Record<string, unknown>;
  const perPortion = parseMacros(nutrition['perPortion']);
  const total = parseMacros(nutrition['total']);
  return perPortion && total ? { perPortion, total } : undefined;
}

/**
 * Parses a macro nutrient object; all four values must be finite, non-negative numbers.
 * @param value Unknown value.
 * @returns The macros, or undefined when a value is missing or invalid.
 */
export function parseMacros(value: unknown): RecipeMacros | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const macros = value as Record<string, unknown>;
  const calories = toFiniteNumber(macros['calories']);
  const protein = toFiniteNumber(macros['protein']);
  const carbs = toFiniteNumber(macros['carbs']);
  const fat = toFiniteNumber(macros['fat']);

  if ([calories, protein, carbs, fat].some((item) => item === null || item < 0)) {
    return undefined;
  }

  return { calories: calories!, protein: protein!, carbs: carbs!, fat: fat! };
}

/**
 * Parses the ingredient coverage percentage.
 * @param value Unknown value.
 * @returns The percentage clamped to 0..100, or undefined when not a number.
 */
export function parseIngredientCoverage(value: unknown): number | undefined {
  const coverage = toFiniteNumber(value);
  return coverage === null ? undefined : Math.min(100, Math.max(0, coverage));
}

/**
 * Converts a number or numeric string into a finite number.
 * @param value Unknown value.
 * @returns The number, or null when it is not a finite number.
 */
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

/**
 * Returns the chef icon for a cook; icons repeat if there are more cooks than icons.
 * @param cook One-based cook number.
 * @returns Path of the cook icon asset.
 */
export function getCookIconSrc(cook: number): string {
  const iconIndex = ((Math.max(1, Math.floor(cook)) - 1) % COOK_ICON_COUNT) + 1;
  return `assets/icons/Cook-icon-${iconIndex}.svg`;
}

/**
 * Groups structured steps into one chronological to-do list per cook.
 * Step numbers follow the global order of the steps array.
 * @param stepDetails Structured steps in chronological order.
 * @param cookCount Number of cooks chosen by the user.
 * @returns One list per cook (1..max(cookCount, highest assigned cook)).
 */
export function buildCookTodoLists(stepDetails: RecipeStepDetail[], cookCount: number): CookTodoList[] {
  const highestAssignedCook = stepDetails.reduce((highest, step) => Math.max(highest, step.cook), 1);
  const listCount = Math.max(1, Math.floor(cookCount) || 1, highestAssignedCook);

  return Array.from({ length: listCount }, (_, index) => {
    const cook = index + 1;
    return {
      cook,
      iconSrc: getCookIconSrc(cook),
      steps: stepDetails
        .map((step, stepIndex) => ({ step, number: stepIndex + 1 }))
        .filter(({ step }) => step.cook === cook)
        .map(({ step, number }) => ({
          number,
          title: step.title,
          instruction: step.instruction,
          parallel: step.parallel,
          durationMinutes: step.durationMinutes,
        })),
    };
  });
}

/**
 * Calculates grams, energy and energy share of protein, carbs and fat.
 * @param macros Macro values in grams.
 * @returns One row per macro nutrient; percentages sum to 100 unless all energy is zero.
 */
export function toMacroRows(macros: RecipeMacros): MacroRow[] {
  const keys: MacroKey[] = ['protein', 'carbs', 'fat'];
  const energies = keys.map((key) => macros[key] * KCAL_PER_GRAM[key]);
  const percentages = toRoundedPercentages(energies);

  return keys.map((key, index) => ({
    key,
    label: macroLabels[key],
    grams: roundToOneDecimal(macros[key]),
    kcal: Math.round(energies[index]),
    percent: percentages[index],
  }));
}

/**
 * Converts values to whole percentages of their sum using the largest remainder method,
 * so the rounded parts still add up to 100.
 * @param values Non-negative values.
 * @returns Whole percentages; all zero when the sum is zero.
 */
export function toRoundedPercentages(values: number[]): number[] {
  const sum = values.reduce((total, value) => total + Math.max(0, value), 0);
  if (sum <= 0) {
    return values.map(() => 0);
  }

  const exact = values.map((value) => (Math.max(0, value) / sum) * 100);
  const rounded = exact.map(Math.floor);
  let remaining = 100 - rounded.reduce((total, value) => total + value, 0);

  exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((first, second) => second.remainder - first.remainder)
    .forEach(({ index }) => {
      if (remaining > 0) {
        rounded[index] += 1;
        remaining -= 1;
      }
    });

  return rounded;
}

/**
 * Rounds a number to at most one decimal place.
 * @param value Any finite number.
 * @returns The rounded number.
 */
function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Extracts JSON from free text (plain JSON, a fenced code block or the first object literal).
 * @param value Text that may contain JSON.
 * @returns The parsed value, or null when no JSON could be parsed.
 */
function tryParseFromText(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fencedMatch?.[1]) {
      try {
        return JSON.parse(fencedMatch[1]);
      } catch {
        return null;
      }
    }

    const objectStart = trimmed.indexOf('{');
    const objectEnd = trimmed.lastIndexOf('}');
    if (objectStart !== -1 && objectEnd > objectStart) {
      try {
        return JSON.parse(trimmed.slice(objectStart, objectEnd + 1));
      } catch {
        return null;
      }
    }
  }

  return null;
}

/**
 * Type guard for the required recipe fields.
 * @param value Unknown value.
 * @returns True when title, description, estimatedMinutes, ingredients and steps are valid.
 */
function isRecipe(value: unknown): value is RecipeShape {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const recipe = value as Partial<RecipeShape>;
  return typeof recipe.title === 'string'
    && typeof recipe.description === 'string'
    && typeof recipe.estimatedMinutes === 'number'
    && Array.isArray(recipe.ingredients)
    && recipe.ingredients.every((item) => typeof item === 'string')
    && Array.isArray(recipe.steps)
    && recipe.steps.every((item) => typeof item === 'string');
}
