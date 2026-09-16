/**
 * @file preferences.ts
 * @description Preferences step: portions, cooks, cooking time, cuisine and diets, quota display and recipe request.
 */
import { Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ImagesComponent } from '../components/images-component/images-component';
import { LoadingStateService } from '../loading-state.service';
import { PreferencesQuotaService } from './preferences-quota.service';
import { CONNECTION_ERROR_MESSAGE, RecipeRequestService, type RequestDialogKind } from './recipe-request.service';
import { clearStoredIngredients } from '../generate-recipe/generate-recipe.utils';
import type {
  CookingTimeId,
  CookingTimeOption,
  CuisineId,
  DietId,
  Option,
  RecipeRequestPayload,
  StoredRecipeContext,
} from './preferences.models';

/** Fallback IP used when the public IP lookup fails. */
const FALLBACK_IP = '127.0.0.1';

/** Dialog titles per dialog kind. */
const DIALOG_TITLES: Record<RequestDialogKind, string> = {
  notice: 'Notice',
  limit: 'Daily limit reached',
  throttle: 'Please wait a moment',
  invalid: 'Request rejected',
  blocked: 'Request blocked',
  failed: 'Recipe generation failed',
  connection: 'Connection failed',
};

@Component({
  selector: 'app-preferences',
  imports: [ImagesComponent, RouterLink],
  templateUrl: './preferences.html',
  styleUrls: ['./preferences.scss'],
  host: { '(document:keydown.escape)': 'closeQuotaDialog()' },
})
/**
 * Preferences page: collects the recipe preferences, shows the remaining daily generations
 * and sends the recipe request to the webhook.
 */
export class Preferences implements OnDestroy {
  private readonly router = inject(Router);
  private readonly loadingStateService = inject(LoadingStateService);
  private readonly quota = inject(PreferencesQuotaService);
  private readonly requests = inject(RecipeRequestService);
  private readonly storageKey = 'cac-ingredients';
  private readonly payloadKey = 'cac-recipe-request';
  private readonly responseKey = 'cac-recipe-results';
  private readonly errorKey = 'cac-recipe-error';
  private readonly ip = signal(FALLBACK_IP);
  /** Bumped whenever the local usage changes, so computed values re-read it. */
  private readonly usageVersion = signal(0);
  private readonly resetClock = signal(Date.now());
  private readonly timer = setInterval(() => this.resetClock.set(Date.now()), 60000);

  readonly cooks = signal(1);
  readonly portions = signal(2);
  readonly selectedCookingTime = signal<CookingTimeId>('medium');
  readonly selectedCuisine = signal<CuisineId>('italian');
  readonly selectedDiets = signal<DietId[]>(['none']);
  readonly submitState = signal<'idle' | 'loading' | 'success' | 'error'>('idle');
  readonly quotaStatus = this.quota.status;
  readonly quotaMessage = this.quota.message;
  readonly quotaDetails = this.quota.details;
  readonly showQuotaDialog = this.quota.dialogVisible;
  readonly quotaExceeded = this.quota.exceeded;
  readonly quotaDialogKind = this.quota.dialogKind;
  readonly isQuotaStatusLoading = this.quota.loading;

  readonly cookingTimeOptions: CookingTimeOption[] = [
    { id: 'quick', label: 'Quick', hint: 'up to 20 min' },
    { id: 'medium', label: 'Medium', hint: '20–45 min' },
    { id: 'complex', label: 'Complex', hint: 'over 45 min' },
  ];
  readonly cuisineOptions: Option<CuisineId>[] = [
    { id: 'german', label: 'German' },
    { id: 'italian', label: 'Italian' },
    { id: 'indian', label: 'Indian' },
    { id: 'japanese', label: 'Japanese' },
    { id: 'gourmet', label: 'Gourmet' },
    { id: 'fusion', label: 'Fusion' },
  ];
  readonly dietOptions: Option<DietId>[] = [
    { id: 'vegetarian', label: 'Vegetarian' },
    { id: 'vegan', label: 'Vegan' },
    { id: 'keto', label: 'Keto' },
    { id: 'none', label: 'No preferences' },
  ];

  /**
   * Whether a new recipe request may be sent (not loading and no daily limit reached).
   * @returns True when the generate button is enabled.
   */
  readonly canSubmitRecipe = computed(() => this.submitState() !== 'loading'
    && !this.isQuotaStatusLoading()
    && !this.quota.hasReached(this.quotaStatus(), this.localUsage()));

  /**
   * Remaining generations as text, available as soon as the local or server quota is known.
   * @returns For example "2 of 3 left today for your IP · 9 of 12 left in the app today", or null while loading.
   */
  readonly quotaSummaryText = computed(() => {
    this.usageVersion();
    this.quotaStatus();
    return this.isQuotaStatusLoading() ? null : this.quota.buildSummaryText(this.ip());
  });

  /**
   * Label of the generate button for the current state.
   * @returns The button text.
   */
  readonly generateButtonLabel = computed(() => {
    if (this.submitState() === 'loading') {
      return 'Generating...';
    }
    if (this.isQuotaStatusLoading()) {
      return 'Checking daily limit...';
    }
    return this.canSubmitRecipe() ? 'Generate a recipe' : 'Ups! Not quite enough...';
  });

  /**
   * Title of the quota/error dialog.
   * @returns The title for the current dialog kind.
   */
  readonly quotaDialogTitle = computed(() => DIALOG_TITLES[this.quotaDialogKind()]);

  /**
   * Message of the quota/error dialog, preferring the message sent by the server.
   * @returns The dialog text.
   */
  readonly quotaDialogMessage = computed(() => {
    const message = this.quotaMessage();
    if (message) {
      return message;
    }
    if (this.quotaDialogKind() === 'connection') {
      return CONNECTION_ERROR_MESSAGE;
    }
    if (this.quotaDialogKind() === 'limit') {
      return this.quota.buildDailyMessage(this.localUsage());
    }
    return 'Please check your recipe request.';
  });

  /**
   * Time until the daily limit resets, shown in the limit dialog.
   * @returns For example "Reset in 5h 12m.", or null when not applicable.
   */
  readonly quotaResetHint = computed(() => {
    this.resetClock();
    if (!this.showQuotaDialog() || this.quotaDialogKind() !== 'limit' || !this.quotaExceeded()) {
      return null;
    }
    const minutes = Math.ceil(this.quota.getResetMs(this.ip()) / 60000);
    return minutes > 0 ? `Reset in ${Math.floor(minutes / 60)}h ${minutes % 60}m.` : null;
  });

  prefBlockIconClock = 'assets/icons/clock_Icon.png';
  prefBlockIconCuisine = 'assets/icons/word_Icon.png';
  prefBlockIconDiet = 'assets/icons/fork_spoon.png';
  heroImageArrow = 'assets/icons/Arrow-left-dark.png';
  heroImageArrowLight = 'assets/icons/Arrow-right.png';
  arrowClass = 'arrow-icon';
  heroImage = 'assets/img/logo-light.png';
  schusselIcon = 'assets/icons/schussel(2).png';
  loffelIcon = 'assets/icons/loffel(1).png';
  karotteIcon = 'assets/icons/karotte.png';
  kohlIcon2 = 'assets/icons/kohl.png';
  rettichIcon3 = 'assets/icons/rettich.png';

  /**
   * Restores today's known server quota and detects the client IP.
   */
  constructor() {
    this.quota.initialize();
    void this.initializeIp();
  }

  /**
   * Stops the reset clock timer.
   */
  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  /**
   * Increases the number of cooks (max 3).
   */
  incrementCooks(): void {
    this.cooks.update((value) => Math.min(3, value + 1));
  }

  /**
   * Decreases the number of cooks (min 1).
   */
  decrementCooks(): void {
    this.cooks.update((value) => Math.max(1, value - 1));
  }

  /**
   * Increases the number of portions (max 12).
   */
  incrementPortions(): void {
    this.portions.update((value) => Math.min(12, value + 1));
  }

  /**
   * Decreases the number of portions (min 1).
   */
  decrementPortions(): void {
    this.portions.update((value) => Math.max(1, value - 1));
  }

  /**
   * Selects the cooking time.
   * @param id - Cooking time id.
   */
  selectCookingTime(id: CookingTimeId): void {
    this.selectedCookingTime.set(id);
  }

  /**
   * Selects the cuisine.
   * @param id - Cuisine id.
   */
  selectCuisine(id: CuisineId): void {
    this.selectedCuisine.set(id);
  }

  /**
   * Checks whether a diet is selected.
   * @param id - Diet id.
   * @returns True when the diet is selected.
   */
  isDietSelected(id: DietId): boolean {
    return this.selectedDiets().includes(id);
  }

  /**
   * Toggles a diet; "No preferences" clears all other diets and is restored when nothing is selected.
   * @param id - Diet id.
   */
  toggleDiet(id: DietId): void {
    if (id === 'none') {
      this.selectedDiets.set(['none']);
      return;
    }

    this.selectedDiets.update((items) => {
      const active = items.filter((item) => item !== 'none');
      const next = active.includes(id) ? active.filter((item) => item !== id) : [...active, id];
      return next.length ? next : ['none'];
    });
  }

  /**
   * Closes the quota/error dialog.
   */
  closeQuotaDialog(): void {
    this.showQuotaDialog.set(false);
  }

  /**
   * Handles the preferences form submit without reloading the page.
   * @param event - Submit event of the form.
   * @returns A promise that resolves when the request has finished.
   */
  async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    await this.generateRecipe();
  }

  /**
   * Sends the recipe request, stores the response and opens the results page;
   * failed requests show a dialog with the server message.
   * @returns A promise that resolves when the request has finished.
   */
  async generateRecipe(): Promise<void> {
    if (this.submitState() === 'loading' || this.isQuotaStatusLoading()) {
      return;
    }
    if (!this.canSubmitRecipe()) {
      this.openDialog('limit', null);
      return;
    }

    const context = this.readContext();
    if (!context.ingredients.length) {
      await this.router.navigate(['/generate-recipe']);
      return;
    }

    const payload = this.buildPayload(context);
    this.setSubmitting(true);
    localStorage.setItem(this.payloadKey, JSON.stringify(payload));
    try {
      const response = await this.requests.send(payload, this.requests.getWebhookUrls());
      this.handleSuccess(response);
      await this.router.navigate(['/results']);
    } catch (error) {
      this.handleError(error);
    } finally {
      this.setSubmitting(false);
    }
  }

  /**
   * Builds the webhook request body from the stored ingredients and the selected preferences.
   * @param context - Stored recipe context with the ingredients.
   * @returns The request payload.
   */
  private buildPayload(context: StoredRecipeContext): RecipeRequestPayload {
    return {
      ingredients: context.ingredients,
      preferences: {
        portions: this.portions(),
        cooks: this.cooks(),
        cookingTime: this.selectedCookingTime(),
        cuisine: this.selectedCuisine(),
        diets: this.selectedDiets(),
      },
      clientIp: this.ip(),
      requestedAt: new Date().toISOString(),
    };
  }

  /**
   * Records the successful generation locally, syncs the server quota, stores the response
   * and clears the ingredient list that was just turned into recipes.
   *
   * This is the single place where the ingredients are cleared, because it runs only after the
   * webhook answered successfully: a failed request (400, 429, 500 or a network error) takes the
   * error path and keeps the list for a retry, and a list that has not been generated yet survives
   * moving between the generate recipe and preferences pages. The request payload and the response
   * stay in localStorage, so the results page keeps working after the ingredients are gone.
   * @param response - Response body of the webhook.
   */
  private handleSuccess(response: unknown): void {
    this.quota.increment(this.ip());
    this.usageVersion.update((value) => value + 1);
    const serverQuota = this.requests.readQuota(response);
    if (serverQuota) {
      this.quota.sync(serverQuota);
    }
    this.quota.message.set(null);
    localStorage.removeItem(this.errorKey);
    localStorage.setItem(this.responseKey, JSON.stringify(response));
    clearStoredIngredients(this.storageKey);
  }

  /**
   * Syncs a quota sent with the error and opens the dialog with the server message or a fallback.
   * @param error - Error thrown by the request.
   */
  private handleError(error: unknown): void {
    const details = this.requests.readApiError(error);
    if (details.quota) {
      this.quota.sync(details.quota);
    }

    const kind = this.requests.getDialogKind(error);
    if (kind === 'limit') {
      this.quota.exceeded.set(true);
    }

    const message = details.message
      ?? (kind === 'limit' ? this.quota.buildDailyMessage(this.localUsage(), details.quota ?? this.quotaStatus()) : null)
      ?? (kind === 'connection' ? CONNECTION_ERROR_MESSAGE : this.requests.toErrorMessage(error));
    this.quota.details.set(details.errors);
    this.openDialog(kind, message);
    localStorage.setItem(this.errorKey, message);
  }

  /**
   * Opens the quota/error dialog.
   * @param kind - Dialog kind.
   * @param message - Message to show, or null for the default text of the kind.
   */
  private openDialog(kind: RequestDialogKind, message: string | null): void {
    if (kind === 'limit' && !message) {
      this.quota.details.set([]);
    }
    this.quota.dialogKind.set(kind);
    this.quota.message.set(message);
    this.quota.dialogVisible.set(true);
  }

  /**
   * Toggles the loading state of the page and the global loading indicator.
   * @param isSubmitting - True while the request is running.
   */
  private setSubmitting(isSubmitting: boolean): void {
    this.submitState.set(isSubmitting ? 'loading' : 'idle');
    this.loadingStateService.setLoading(isSubmitting);
  }

  /**
   * Detects the public client IP and then refreshes the local quota state.
   * @returns A promise that resolves when the quota state is ready.
   */
  private async initializeIp(): Promise<void> {
    try {
      const response = await fetch('https://api.ipify.org?format=json');
      if (response.ok) {
        const body = await response.json() as { ip?: string };
        this.ip.set(body.ip || FALLBACK_IP);
      }
    } catch {
      this.ip.set(FALLBACK_IP);
    }

    this.quota.clearExpired(this.ip());
    this.usageVersion.update((value) => value + 1);
    this.quota.setLoading(false);
  }

  /**
   * Returns today's local usage of the current IP (tracked through usageVersion for computed values).
   * @returns Number of generations used today.
   */
  private localUsage(): number {
    this.usageVersion();
    return this.quota.getUsage(this.ip());
  }

  /**
   * Reads the stored ingredients from localStorage.
   * @returns The stored context, or an empty ingredient list when nothing valid is stored.
   */
  private readContext(): StoredRecipeContext {
    try {
      const parsed = JSON.parse(localStorage.getItem(this.storageKey) ?? '{}') as StoredRecipeContext;
      return Array.isArray(parsed.ingredients) ? parsed : { ingredients: [] };
    } catch {
      return { ingredients: [] };
    }
  }
}
