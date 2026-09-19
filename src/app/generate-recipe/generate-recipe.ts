/**
 * @file generate-recipe.ts
 * @description Page component where users collect the ingredients for a recipe request.
 */
import { Component, inject } from '@angular/core';
import { TranslatePipe } from '../i18n/translate.pipe';
import { Router } from '@angular/router';
import { ImagesComponent } from '../components/images-component/images-component';
import { IngredientEditorService } from './ingredient-editor.service';

@Component({
  selector: 'app-generate-recipe',
  imports: [ImagesComponent, TranslatePipe],
  templateUrl: './generate-recipe.html',
  styleUrls: ['./generate-recipe.scss'],
})
/**
 * Generate recipe page: renders the ingredient form and list (logic lives in IngredientEditorService)
 * and navigates to the preferences step.
 */
export class GenerateRecipe extends IngredientEditorService {
  private readonly router = inject(Router);

  readonly arrowDropDownIcon = 'assets/icons/arrow_drop_down.png';

  /**
   * Handles the add form submit without reloading the page.
   * @param event - Optional submit event.
   */
  onSubmit(event?: Event): void {
    event?.preventDefault();
    this.addIngredient();
  }

  /**
   * Handles the submit of an inline edit form.
   * @param event - Submit event of the edit form.
   * @param index - Position of the edited ingredient.
   */
  onEditSubmit(event: Event, index: number): void {
    event.preventDefault();
    this.saveIngredientEdit(index);
  }

  /**
   * Navigates to the preferences step when enough ingredients are listed.
   */
  goToPreferences(): void {
    if (this.ingredients().length < this.minIngredientsRequired) {
      this.formValidationMessage.set(this.minIngredientsMessage);
      return;
    }

    this.formValidationMessage.set('');
    void this.router.navigate(['/preferences']);
  }
}
