/**
 * @file ingredient-editor.service.ts
 * @description State and logic for adding, editing and deleting ingredients on the generate recipe page.
 */
import { computed, inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { I18nService } from '../i18n/i18n.service';
import {
  INGREDIENT_UNIT_OPTIONS,
  getUnitLabel,
  isIngredientUnitId,
  isValidIngredientName,
  isValidQuantity,
  readStoredIngredients,
  readStoredRecipeContext,
  sanitizeIngredientName,
  toIngredientSlug,
  type IngredientUnitId,
  type RecipeIngredient,
} from './generate-recipe.utils';

/** Quantity and unit of the ingredient that is currently edited in the list. */
export interface EditableIngredient {
  quantity: number;
  unit: IngredientUnitId;
}

/**
 * Ingredient list logic of the generate recipe page (validation, merge of duplicates, storage, autocomplete).
 */
@Injectable({ providedIn: 'root' })
export class IngredientEditorService {
  protected readonly http = inject(HttpClient);
  protected readonly i18n = inject(I18nService);
  protected readonly databaseUrl = environment.firebaseDatabaseUrl;
  protected readonly storageKey = 'cac-ingredients';
  protected readonly recipePayloadKey = 'cac-recipe-request';
  protected readonly recipesResponseKey = 'cac-recipe-results';
  protected readonly ingredientNamePattern = /^[A-Za-zÄÖÜäöüß0-9\s'()-]+$/;
  protected readonly maxIngredientNameLength = 40;
  protected readonly defaultQuantity = 1;
  protected readonly defaultUnit: IngredientUnitId = 'gram';
  protected readonly suggestionMinLength = 3;
  readonly minIngredientsRequired = 1;
  readonly firebaseIngredientNames = signal<string[]>([]);
  readonly ingredientValidationMessage = signal('');
  readonly quantityValidationMessage = signal('');
  readonly editValidationMessage = signal('');
  readonly formValidationMessage = signal('');
  readonly ingredientsSignal = signal<RecipeIngredient>(this.createEmptyIngredient());
  readonly editingIndex = signal<number | null>(null);
  readonly isIngredientSuggestionsOpen = signal(false);
  readonly isCreateUnitMenuOpen = signal(false);
  readonly isEditUnitMenuOpen = signal(false);
  readonly editingIngredient = signal<EditableIngredient>({ quantity: this.defaultQuantity, unit: this.defaultUnit });
  readonly ingredients = signal<RecipeIngredient[]>([]);

  /**
   * Hint for an ingredient name with characters that are not allowed.
   * @returns The hint in the current language.
   */
  protected get ingredientHintMessage(): string {
    return this.i18n.t('generate.hintName');
  }

  /**
   * Hint for an empty ingredient name; the template compares against it for its styling.
   * @returns The hint in the current language.
   */
  get emptyIngredientHintMessage(): string {
    return this.i18n.t('generate.hintEmpty');
  }

  /**
   * Hint for a missing or non-positive quantity.
   * @returns The hint in the current language.
   */
  get quantityHintMessage(): string {
    return this.i18n.t('generate.hintQuantity');
  }

  /**
   * Message shown when the next step is requested without ingredients.
   * @returns The message in the current language.
   */
  get minIngredientsMessage(): string {
    return this.i18n.t('generate.hintMin');
  }
  readonly unitOptions = INGREDIENT_UNIT_OPTIONS;
  /** Whether at least one ingredient is listed. */
  readonly hasIngredients = computed(() => this.ingredients().length > 0);
  readonly ingredientCatalog = [
    'Apple', 'Apfel', 'Basil', 'Basilikum', 'Bell Pepper', 'Paprika', 'Bread', 'Brot', 'Broccoli', 'Brokkoli',
    'Butter', 'Carrot', 'Karotte', 'Moehre', 'Cheese', 'Käse', 'Chicken Breast', 'Huehnchenbrust', 'Cucumber',
    'Gurke', 'Egg', 'Ei', 'Flour', 'Mehl', 'Garlic', 'Knoblauch', 'Milk', 'Milch', 'Mozzarella', 'Mushroom',
    'Pilze', 'Champignon', 'Onion', 'Zwiebel', 'Olive Oil', 'Olivenoel', 'Oregano', 'Parmesan', 'Pasta', 'Nudeln',
    'Potato', 'Kartoffel', 'Potatoes', 'Kartoffeln', 'Rice', 'Reis', 'Spaghetti', 'Tomato', 'Tomate',
    'Tomato Sauce', 'Tomatensauce', 'Zucchini',
  ];

  /**
   * Autocomplete suggestions for the current ingredient name (Firebase names plus the local catalog).
   * @returns Up to 8 names starting with the typed text, or an empty list for short input.
   */
  readonly ingredientSuggestions = computed(() => {
    const query = this.ingredientsSignal().name.trim().toLowerCase();
    if (query.length < this.suggestionMinLength) {
      return [];
    }

    const names = new Set([...this.firebaseIngredientNames(), ...this.ingredientCatalog]);
    return Array.from(names)
      .filter((name) => name.toLowerCase().startsWith(query))
      .slice(0, 8);
  });

  /**
   * Restores the stored ingredient list and loads known ingredient names for autocomplete.
   */
  constructor() {
    this.loadIngredientsFromStorage();
    void this.loadIngredientsFromFirebase();
  }

  /**
   * Updates the ingredient name from the input, validates it and opens suggestions when useful.
   * @param event - Input event of the ingredient name field.
   */
  setIngredientName(event: Event): void {
    const name = sanitizeIngredientName((event.target as HTMLInputElement).value);
    this.ingredientsSignal.update((item) => ({ ...item, name }));

    const isValid = isValidIngredientName(name, this.ingredientNamePattern, this.maxIngredientNameLength);
    this.ingredientValidationMessage.set(this.getNameValidationMessage(name, isValid));

    const shouldOpenSuggestions = name.length >= this.suggestionMinLength && isValid;
    this.isIngredientSuggestionsOpen.set(shouldOpenSuggestions);
    if (shouldOpenSuggestions) {
      void this.loadIngredientsFromFirebase();
    }
  }

  /**
   * Closes the suggestion list when focus leaves the name field, unless focus moved into the list.
   * @param event - Optional blur event used to detect focus moving to a suggestion.
   */
  onIngredientFieldBlur(event?: FocusEvent): void {
    const nextFocus = event?.relatedTarget;
    if (nextFocus instanceof HTMLElement && nextFocus.closest('.ingredient-suggestions')) {
      return;
    }

    setTimeout(() => this.isIngredientSuggestionsOpen.set(false), 120);
  }

  /**
   * Applies an autocomplete suggestion as ingredient name.
   * @param name - Selected suggestion.
   */
  selectIngredientSuggestion(name: string): void {
    this.ingredientsSignal.update((item) => ({ ...item, name }));
    this.ingredientValidationMessage.set('');
    this.isIngredientSuggestionsOpen.set(false);
  }

  /**
   * Updates the quantity of the new ingredient from the number input.
   * @param event - Input event of the quantity field.
   */
  setIngredientQuantity(event: Event): void {
    const quantity = this.readQuantity(event);
    this.ingredientsSignal.update((item) => ({ ...item, quantity }));
    this.quantityValidationMessage.set(isValidQuantity(quantity) ? '' : this.quantityHintMessage);
  }

  /**
   * Increases the quantity of the new ingredient by one.
   */
  incrementIngredientQuantity(): void {
    this.ingredientsSignal.update((item) => ({ ...item, quantity: this.increaseQuantity(item.quantity) }));
    this.quantityValidationMessage.set('');
  }

  /**
   * Decreases the quantity of the new ingredient by one without going below 1.
   */
  decrementIngredientQuantity(): void {
    this.ingredientsSignal.update((item) => ({ ...item, quantity: this.decreaseQuantity(item.quantity) }));
  }

  /**
   * Sets the unit of the new ingredient from a native select element.
   * @param event - Change event of a select element.
   */
  setIngredientUnit(event: Event): void {
    this.selectCreateUnit((event.target as HTMLSelectElement).value);
  }

  /**
   * Opens or closes the unit menu of the add form.
   */
  toggleCreateUnitMenu(): void {
    this.isCreateUnitMenuOpen.update((open) => !open);
  }

  /**
   * Selects the unit of the new ingredient and closes the menu.
   * @param unit - Selected unit id; unknown values are ignored.
   */
  selectCreateUnit(unit: string): void {
    if (isIngredientUnitId(unit)) {
      this.ingredientsSignal.update((item) => ({ ...item, unit }));
    }
    this.isCreateUnitMenuOpen.set(false);
  }

  /**
   * Returns the short display label of a unit.
   * @param unit - Unit id.
   * @returns The label, for example 'g' or 'pcs'.
   */
  formatUnit(unit: string): string {
    return this.i18n.label('unit', unit) || getUnitLabel(unit);
  }

  /**
   * Validates the add form and appends the ingredient; an existing ingredient with the same
   * name and unit is merged by adding the quantities, a different unit is rejected with a hint.
   */
  addIngredient(): void {
    const item = this.ingredientsSignal();
    const name = sanitizeIngredientName(item.name);
    const quantity = Number(item.quantity);
    if (!this.validateNewIngredient(name, quantity)) {
      return;
    }

    const existingIndex = this.findIngredientIndex(name);
    if (existingIndex === -1) {
      this.ingredients.update((items) => [...items, { name, quantity, unit: item.unit }]);
    } else if (!this.mergeIngredient(existingIndex, quantity, item.unit)) {
      return;
    }

    this.persistIngredients();
    void this.persistIngredientToFirebase(name);
    this.resetAddForm();
  }

  /**
   * Starts editing quantity and unit of a listed ingredient.
   * @param index - Position of the ingredient in the list.
   */
  editIngredient(index: number): void {
    const item = this.ingredients()[index];
    if (!item) {
      return;
    }

    this.editingIndex.set(index);
    this.isEditUnitMenuOpen.set(false);
    this.editValidationMessage.set('');
    this.editingIngredient.set({ quantity: item.quantity, unit: item.unit });
  }

  /**
   * Updates the quantity of the edited ingredient from the number input.
   * @param event - Input event of the edit quantity field.
   */
  setEditingIngredientQuantity(event: Event): void {
    const quantity = this.readQuantity(event);
    this.editingIngredient.update((item) => ({ ...item, quantity }));
    this.editValidationMessage.set(isValidQuantity(quantity) ? '' : this.quantityHintMessage);
  }

  /**
   * Increases the quantity of the edited ingredient by one.
   */
  incrementEditingIngredientQuantity(): void {
    this.editingIngredient.update((item) => ({ ...item, quantity: this.increaseQuantity(item.quantity) }));
    this.editValidationMessage.set('');
  }

  /**
   * Decreases the quantity of the edited ingredient by one without going below 1.
   */
  decrementEditingIngredientQuantity(): void {
    this.editingIngredient.update((item) => ({ ...item, quantity: this.decreaseQuantity(item.quantity) }));
  }

  /**
   * Sets the unit of the edited ingredient from a native select element.
   * @param event - Change event of a select element.
   */
  setEditingIngredientUnit(event: Event): void {
    this.selectEditUnit((event.target as HTMLSelectElement).value);
  }

  /**
   * Opens or closes the unit menu of the edited ingredient.
   */
  toggleEditUnitMenu(): void {
    this.isEditUnitMenuOpen.update((open) => !open);
  }

  /**
   * Selects the unit of the edited ingredient and closes the menu.
   * @param unit - Selected unit id; unknown values are ignored.
   */
  selectEditUnit(unit: string): void {
    if (isIngredientUnitId(unit)) {
      this.editingIngredient.update((item) => ({ ...item, unit }));
    }
    this.isEditUnitMenuOpen.set(false);
  }

  /**
   * Saves the edited quantity and unit when the quantity is valid, then leaves edit mode.
   * @param index - Position of the edited ingredient in the list.
   */
  saveIngredientEdit(index: number): void {
    const edit = this.editingIngredient();
    if (!this.ingredients()[index]) {
      return;
    }
    if (!isValidQuantity(edit.quantity)) {
      this.editValidationMessage.set(this.quantityHintMessage);
      return;
    }

    this.ingredients.update((items) =>
      items.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: edit.quantity, unit: edit.unit } : item)
    );
    this.persistIngredients();
    this.cancelEdit();
  }

  /**
   * Removes an ingredient and keeps the edit index pointing at the same item.
   * @param index - Position of the ingredient to delete.
   */
  deleteIngredient(index: number): void {
    const currentEditingIndex = this.editingIndex();
    this.ingredients.update((items) => items.filter((_, itemIndex) => itemIndex !== index));

    if (currentEditingIndex === index) {
      this.cancelEdit();
    } else if (currentEditingIndex !== null && currentEditingIndex > index) {
      this.editingIndex.set(currentEditingIndex - 1);
    }

    this.persistIngredients();
  }

  /**
   * Leaves edit mode and discards unsaved edits by reloading the stored list.
   */
  cancelEdit(): void {
    this.loadIngredientsFromStorage();
    this.editingIndex.set(null);
    this.isEditUnitMenuOpen.set(false);
    this.editValidationMessage.set('');
    this.editingIngredient.set({ quantity: this.defaultQuantity, unit: this.defaultUnit });
  }

  /**
   * Loads the ingredient list from localStorage into the list signal.
   */
  protected loadIngredientsFromStorage(): void {
    this.ingredients.set(readStoredIngredients(this.storageKey));
  }

  /**
   * Writes the ingredient list into the stored recipe context and invalidates cached results.
   */
  protected persistIngredients(): void {
    const context = readStoredRecipeContext(this.storageKey);
    localStorage.setItem(this.storageKey, JSON.stringify({ ...context, ingredients: this.ingredients() }));
    this.clearRecipeGenerationCache();
  }

  /**
   * Removes the stored request payload and results so a changed list triggers a new generation.
   */
  protected clearRecipeGenerationCache(): void {
    localStorage.removeItem(this.recipePayloadKey);
    localStorage.removeItem(this.recipesResponseKey);
  }

  /**
   * Loads ingredient names saved by other users from Firebase for autocomplete.
   * @returns A promise that resolves when the names are loaded (errors are logged).
   */
  protected async loadIngredientsFromFirebase(): Promise<void> {
    try {
      const url = `${this.databaseUrl}/ingredients.json`;
      const response = await firstValueFrom(this.http.get<Record<string, { name?: string }> | null>(url));
      const names = Object.values(response ?? {})
        .map((item) => item?.name?.trim() ?? '')
        .filter(Boolean);
      this.firebaseIngredientNames.set(Array.from(new Set([...this.ingredientCatalog, ...names])));
    } catch (error) {
      console.error('Unable to load ingredients from Firebase:', error);
    }
  }

  /**
   * Stores a new ingredient name in Firebase so it appears in future suggestions.
   * @param name - Ingredient name to store; known names are skipped.
   * @returns A promise that resolves when the name is stored (errors are logged).
   */
  protected async persistIngredientToFirebase(name: string): Promise<void> {
    const normalized = name.trim();
    const isKnown = this.firebaseIngredientNames().some((item) => item.toLowerCase() === normalized.toLowerCase());
    if (!normalized || isKnown) {
      return;
    }

    try {
      const url = `${this.databaseUrl}/ingredients/${toIngredientSlug(normalized)}.json`;
      await firstValueFrom(this.http.put(url, { name: normalized, createdAt: new Date().toISOString() }));
      this.firebaseIngredientNames.update((items) => Array.from(new Set([...items, normalized])));
    } catch (error) {
      console.error('Unable to persist ingredient to Firebase:', error);
    }
  }

  /**
   * Validates name and quantity of a new ingredient and sets the matching hint messages.
   * @param name - Sanitized ingredient name.
   * @param quantity - Entered quantity.
   * @returns True when the ingredient may be added.
   */
  private validateNewIngredient(name: string, quantity: number): boolean {
    const isNameValid = isValidIngredientName(name, this.ingredientNamePattern, this.maxIngredientNameLength);
    this.ingredientValidationMessage.set(this.getNameValidationMessage(name, isNameValid));
    this.quantityValidationMessage.set(isValidQuantity(quantity) ? '' : this.quantityHintMessage);
    return isNameValid && isValidQuantity(quantity);
  }

  /**
   * Returns the hint for an ingredient name.
   * @param name - Sanitized ingredient name.
   * @param isValid - Result of the name validation.
   * @returns An empty string for valid names, otherwise the matching hint.
   */
  private getNameValidationMessage(name: string, isValid: boolean): string {
    if (!name) {
      return this.emptyIngredientHintMessage;
    }
    return isValid ? '' : this.ingredientHintMessage;
  }

  /**
   * Finds a listed ingredient by name, ignoring case.
   * @param name - Sanitized ingredient name.
   * @returns The list index, or -1 when the ingredient is not listed yet.
   */
  private findIngredientIndex(name: string): number {
    const normalizedName = name.toLowerCase();
    return this.ingredients().findIndex((item) => item.name.trim().toLowerCase() === normalizedName);
  }

  /**
   * Adds a quantity to an already listed ingredient with the same unit.
   * @param index - List index of the existing ingredient.
   * @param quantity - Quantity to add.
   * @param unit - Unit of the new entry.
   * @returns True when merged, false when the units differ (a hint is shown instead).
   */
  private mergeIngredient(index: number, quantity: number, unit: IngredientUnitId): boolean {
    const existing = this.ingredients()[index];
    if (existing.unit !== unit) {
      this.ingredientValidationMessage.set(
        this.i18n.t('generate.hintDuplicate', { name: existing.name, unit: this.formatUnit(existing.unit) })
      );
      return false;
    }

    this.ingredients.update((items) =>
      items.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: item.quantity + quantity } : item)
    );
    return true;
  }

  /**
   * Clears the add form and all related hints and menus.
   */
  private resetAddForm(): void {
    this.ingredientsSignal.set(this.createEmptyIngredient());
    this.ingredientValidationMessage.set('');
    this.quantityValidationMessage.set('');
    this.formValidationMessage.set('');
    this.isIngredientSuggestionsOpen.set(false);
    this.isCreateUnitMenuOpen.set(false);
  }

  /**
   * Creates the initial state of the add form.
   * @returns An ingredient with empty name, default quantity and default unit.
   */
  private createEmptyIngredient(): RecipeIngredient {
    return { name: '', quantity: this.defaultQuantity, unit: this.defaultUnit };
  }

  /**
   * Reads a numeric value from a number input event.
   * @param event - Input event of a number field.
   * @returns The entered number, or 0 when the input is not a finite number.
   */
  private readQuantity(event: Event): number {
    const value = Number((event.target as HTMLInputElement).value);
    return Number.isFinite(value) ? value : 0;
  }

  /**
   * Increases a quantity by one, treating negative values as 0.
   * @param quantity - Current quantity.
   * @returns The increased quantity.
   */
  private increaseQuantity(quantity: number): number {
    return Math.max(0, quantity) + 1;
  }

  /**
   * Decreases a quantity by one while keeping it at least 1.
   * @param quantity - Current quantity.
   * @returns The decreased quantity, or the unchanged value when it is already 1 or less.
   */
  private decreaseQuantity(quantity: number): number {
    return quantity > 1 ? Math.max(1, quantity - 1) : quantity;
  }
}
