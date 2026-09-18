/**
 * @file preferences.spec.ts
 * @description Unit tests for the preferences page.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { Preferences } from './preferences';
import { RecipeRequestService } from './recipe-request.service';
import { readStoredIngredients } from '../generate-recipe/generate-recipe.utils';

/** Ingredient list a user collected before opening the preferences page. */
const storedIngredients = [{ name: 'Tomato', quantity: 2, unit: 'piece' }];

describe('Preferences', () => {
  let component: Preferences;
  let fixture: ComponentFixture<Preferences>;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    localStorage.clear();
    globalThis.fetch = (() => Promise.reject(new Error('offline'))) as typeof fetch;

    await TestBed.configureTestingModule({
      imports: [Preferences],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'results', children: [] }, { path: 'generate-recipe', children: [] }]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Preferences);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  /**
   * Stores an ingredient list and stubs the webhook request with a fixed outcome.
   * @param outcome Response body the request resolves with, or the error it rejects with.
   * @returns A promise that resolves once the quota state is ready.
   */
  async function prepareGeneration(outcome: { response: unknown } | { error: unknown }): Promise<void> {
    localStorage.setItem('cac-ingredients', JSON.stringify({ ingredients: storedIngredients }));
    const requests = TestBed.inject(RecipeRequestService);
    vi.spyOn(requests, 'getWebhookUrls').mockReturnValue(['https://example.test/webhook/recipe']);
    vi.spyOn(requests, 'send').mockImplementation(() =>
      'response' in outcome ? Promise.resolve(outcome.response) : Promise.reject(outcome.error)
    );

    await new Promise((resolve) => setTimeout(resolve));
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should show the cooking time hints', () => {
    expect(component.cookingTimeOptions.map((option) => option.hint)).toEqual(['up to 20 min', '20–45 min', 'over 45 min']);
  });

  it('should reset other diets when "No restrictions" is selected', () => {
    component.toggleDiet('vegan');
    component.toggleDiet('keto');
    expect(component.selectedDiets()).toEqual(['vegan', 'keto']);

    component.toggleDiet('none');
    expect(component.selectedDiets()).toEqual(['none']);
  });

  it('should show the remaining generations once the local quota is known', async () => {
    await new Promise((resolve) => setTimeout(resolve));

    expect(component.quotaSummaryText()).toBe('3 of 3 left today for your IP');
  });

  it('clears the stored ingredients after a successful generation', async () => {
    await prepareGeneration({ response: { result: { recipes: [] } } });

    await component.generateRecipe();

    expect(readStoredIngredients('cac-ingredients')).toEqual([]);
    expect(localStorage.getItem('cac-recipe-request')).toBeTruthy();
    expect(localStorage.getItem('cac-recipe-results')).toBeTruthy();
  });

  it('keeps the stored ingredients when the generation fails', async () => {
    await prepareGeneration({ error: new HttpErrorResponse({ status: 500, statusText: 'Server Error' }) });

    await component.generateRecipe();

    expect(readStoredIngredients('cac-ingredients')).toEqual(storedIngredients);
  });

  it('keeps the stored ingredients when the webhook cannot be reached', async () => {
    await prepareGeneration({ error: new HttpErrorResponse({ status: 0, statusText: 'Unknown Error' }) });

    await component.generateRecipe();

    expect(readStoredIngredients('cac-ingredients')).toEqual(storedIngredients);
  });
});
