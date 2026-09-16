<div align="center">

# Code à Cuisine

**AI-powered recipe generator.** Enter what's in your kitchen, pick your preferences, and get three recipes cooked up by an AI agent.

![Angular](https://img.shields.io/badge/Angular-22-DD0031?logo=angular&logoColor=white)
![n8n](https://img.shields.io/badge/n8n-workflow-EA4B71?logo=n8n&logoColor=white)
![Ollama](https://img.shields.io/badge/Ollama_Cloud-gemma4:31b-000000?logo=ollama&logoColor=white)
![Firebase](https://img.shields.io/badge/Firebase-Realtime_DB-FFCA28?logo=firebase&logoColor=black)

![Code à Cuisine start page](docs/screenshots/hero.jpg)

</div>

## Features

- **Ingredients in, recipes out.** Add at least three ingredients with quantity and unit, and the AI builds three matching recipes around them.
- **Preferences.** Portions, number of cooks, cooking time (quick / medium / complex), cuisine (German, Italian, Indian, Japanese, Gourmet, Fusion) and diets (vegetarian, vegan, keto).
- **Step-by-step directions.** Each recipe splits your ingredients from the extras it needs and assigns steps to the cooks.
- **Cookbook.** Every generated recipe is saved. Browse by cuisine, see the most liked recipes and give your favourites a heart.
- **Fair use limit.** 3 generations per IP and 12 in total per 24 hours, enforced in the workflow and stored in Firebase.
- **Responsive.** Built for desktop and mobile.

## Screenshots

| Add ingredients | Choose preferences |
| :---: | :---: |
| ![Generate recipe](docs/screenshots/generate-recipe.jpg) | ![Preferences](docs/screenshots/preferences.jpg) |
| **Your three recipes** | **Cookbook** |
| ![Results](docs/screenshots/results.jpg) | ![Cookbook](docs/screenshots/cookbook.jpg) |
| **Ingredients** | **Directions** |
| ![Recipe ingredients](docs/screenshots/recipe-ingredients.jpg) | ![Recipe directions](docs/screenshots/recipe-directions.jpg) |


## How it works

```mermaid
flowchart LR
    A[Angular app] -- "POST ingredients + preferences" --> B[n8n webhook]
    B --> V{Validate request}
    V -- invalid --> X[400 response]
    V -- ok --> C{IP quota + throttle}
    C -- "limit reached" --> D[429 response]
    C -- ok --> E[LLM chain]
    E <--> F[Ollama Cloud<br/>gemma4:31b]
    E --> G[Validate 3 recipes]
    G -- "rule broken, 1 retry" --> E
    G --> A
    C <--> H[(Firebase<br/>Realtime DB)]
    A <-- "cookbook, likes, ingredients" --> H
```

1. The app sends the ingredient list and preferences to the n8n webhook `code-a-cuisine-recipe`.
2. The workflow validates the request again (ingredients, quantities, units, portions, cooks, time, cuisine, diets) and answers invalid input with 400.
3. It reads the caller IP (IPv4 or IPv6) from the proxy headers and enforces 3 recipes per IP per day, 12 per day in total and a 15 second throttle, stored in Firebase (429 with a readable message).
4. A Basic LLM Chain with a structured output parser asks the model for exactly three recipes in a fixed JSON schema: at least 70 % of your ingredients, at most 3 extras, scaled quantities, tasks per cook with parallel steps, and nutrition per portion and in total.
5. The answer is checked against these rules and retried once with feedback. Failures are logged in Firebase and answered with 500; crashes trigger the error workflow with an email.
6. The app stores the recipes in Firebase so they show up in the cookbook.

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | Angular 22 (standalone components, signals), SCSS |
| Backend | n8n Cloud workflow (`n8n/code-a-cuisine-recipe-agent.json`) |
| AI | Ollama Cloud, `gemma4:31b`, via the OpenAI-compatible API |
| Database | Firebase Realtime Database (`database.rules.json`) |

## Getting started

```bash
git clone https://github.com/alexlindt-arch/code-a-cuisine.git
cd code-a-cuisine
npm install
npm start
```

The app runs on `http://localhost:4200`.

### Configuration

Both endpoints live in `src/environments/environment.ts` and `environment.prod.ts`:

```ts
const n8nBaseUrl = 'https://<your-name>.app.n8n.cloud/';

export const environment = {
  production: true,
  n8nBaseUrl,
  recipeWebhookUrl: `${n8nBaseUrl}webhook/`,
  firebaseDatabaseUrl: 'https://<your-project>-default-rtdb.<region>.firebasedatabase.app',
};
```

### Backend setup

- **n8n:** import the workflow, connect the model and activate it. See [`n8n/README.md`](n8n/README.md).
- **Firebase:** create a Realtime Database and deploy the rules with `firebase deploy --only database`. Also set the database URL in the *Check IP Quota* node of the workflow.

## Project structure

```
src/app/
├── hero/               start page
├── generate-recipe/    ingredient input
├── preferences/        preferences, quota handling, webhook request
├── results/            the three generated recipes
├── recipe-detail/      ingredients and directions
├── cookbook/           saved recipes, most liked
├── cookbook-category/  recipes per cuisine
└── impress/            imprint
n8n/                    workflow export and setup guide
docs/screenshots/       README images
```

## Author

**Alexander Lindt**: [GitHub](https://github.com/alexlindt-arch)
