# n8n workflows

| File | Purpose |
| --- | --- |
| `code-a-cuisine-recipe-agent.json` | Recipe API for the Angular app: validation, IP quota, AI generation, result validation, responses |
| `code-a-cuisine-error-handler.json` | Error workflow: sends an email and logs to Firebase when the recipe workflow crashes |

## API contract

`POST <n8nBaseUrl>webhook/code-a-cuisine-recipe`

### Request

```json
{
  "ingredients": [{ "name": "tomato", "quantity": 300, "unit": "gram" }],
  "preferences": {
    "portions": 2,
    "cooks": 1,
    "cookingTime": "quick",
    "cuisine": "italian",
    "diets": ["none"]
  },
  "clientIp": "203.0.113.7",
  "requestedAt": "2026-09-13T18:00:00.000Z"
}
```

| Field | Rule |
| --- | --- |
| `ingredients` | 1–30 items, duplicates (same name and unit) are merged |
| `name` | 1–60 letters, numbers, spaces, hyphens, apostrophes, parentheses |
| `quantity` | number > 0 |
| `unit` | `gram`, `kg`, `ml`, `liter`, `piece` |
| `portions` | whole number 1–12 |
| `cooks` | whole number 1–3 |
| `cookingTime` | `quick` (≤ 20 min), `medium` (20–45 min), `complex` (> 45 min) |
| `cuisine` | `german`, `italian`, `indian`, `japanese`, `gourmet`, `fusion` |
| `diets` | one or more of `vegetarian`, `vegan`, `keto`, or only `none` |

### Responses

| Status | Body |
| --- | --- |
| 200 | `{ request, requesterIp, generatedAt, quota, warnings, attempts, result: { recipes } }` |
| 400 | `{ message, code: "INVALID_REQUEST", errors: string[] }` |
| 429 | `{ message, code: "QUOTA_EXCEEDED" \| "GLOBAL_QUOTA_EXCEEDED" \| "THROTTLED" \| "IP_NOT_DETECTED", quota }` |
| 500 | `{ message, code: "RECIPE_GENERATION_FAILED", generatedAt }` |

A recipe in `result.recipes` (always 3):

```json
{
  "title": "Fresh Tomato Garlic Pasta",
  "description": "…",
  "estimatedMinutes": 20,
  "ingredients": ["200 g pasta", "250 g tomato", "10 g garlic", "1 tbsp olive oil"],
  "extraIngredients": ["1 tbsp olive oil"],
  "steps": ["Boil water: Bring salted water to a boil."],
  "stepDetails": [{ "title": "Boil water", "instruction": "Bring salted water to a boil.", "cook": 1, "parallel": false, "durationMinutes": 8 }],
  "nutrition": {
    "perPortion": { "calories": 520, "protein": 17, "carbs": 88, "fat": 11 },
    "total": { "calories": 1040, "protein": 34, "carbs": 176, "fat": 22 }
  },
  "ingredientCoverage": 100
}
```

`quota`: `{ date: "YYYY-MM-DD", ipAddress, ipVersion: "ipv4" | "ipv6", perIpLimit, perIpUsed, perIpRemaining, globalLimit, globalUsed, globalRemaining }`

## How the recipe workflow works

1. **Validate Request** checks every field above before any quota is used (400 on errors).
2. **Check IP Quota** reads the caller IP (IPv4 or IPv6) from the proxy headers and enforces
   - 3 generations per IP per calendar day (Europe/Berlin); users behind one shared IP share them,
   - 12 generations per day for the whole app,
   - 15 seconds between two requests of the same IP (throttling as cost airbag).

   Counters live in Firebase `quota/<date>/ips/<ip>` and `quota/<date>/global`; workflow static data is the fallback if Firebase is unreachable.
3. **Prepare Prompt** tells the model to use at least 70 % of the ingredients, add at most 3 basic extras, scale quantities to the portions, respect time frame, cuisine and diet, give every cook their own tasks, mark parallel steps, use waiting times and estimate nutrition per portion and in total.
4. **Generate Recipes** (Basic LLM Chain with Ollama Cloud `gemma4:31b`) generates the JSON. The **Structured Output Parser** appends the JSON schema to the prompt and parses the answer. Its auto-fix option stays off: the repair call re-prompts the model without the ingredients.
5. **Validate Recipe Result** only checks what the schema cannot express: at least 70 % of the ingredients used, at most 3 extras, tasks for every cook and three different recipes. Broken rules send the answer back once with the reasons (**Route on Retry**); an unusable second answer becomes a 500.
6. **Log Recipe Error** writes failures to the execution log and Firebase `logs/recipeErrors`.

Every node has a description (visible under the node) and the canvas is split into sticky-note sections.

## Setup on your own n8n instance

1. **Create an instance**: n8n Cloud (`https://<name>.app.n8n.cloud/`) or self-hosted with a public HTTPS domain.
2. **Import both workflows**: Workflows → *Import from File*.
3. **AI model**: open *Ollama Cloud Chat Model* (an OpenAI Chat Model node) and create an **OpenAI** credential
   - API Key: your key from https://ollama.com/settings/keys
   - Base URL: `https://ollama.com/v1`
   - the native Ollama Chat Model node did not send the API key to Ollama Cloud (401), hence the OpenAI-compatible route
4. **Firebase**: set your Realtime Database URL in *Check IP Quota*, *Log Recipe Error* and *Format Error Report* (`const dbUrl = …`) and deploy the rules with `firebase deploy --only database`.
5. **Error handling**: in *Code-a-Cuisine Error Handler* open *Send Error Email*, add an SMTP credential, sender and recipient. In the recipe workflow open *Settings → Error workflow* and pick *Code-a-Cuisine Error Handler*.
6. **Activate** the recipe workflow and set `n8nBaseUrl` in `src/environments/environment*.ts`.

## Quick test

```bash
curl -X POST https://<name>.app.n8n.cloud/webhook/code-a-cuisine-recipe \
  -H "Content-Type: application/json" \
  -d '{"ingredients":[{"name":"tomato","quantity":300,"unit":"gram"},{"name":"pasta","quantity":200,"unit":"gram"}],"preferences":{"portions":2,"cooks":2,"cookingTime":"quick","cuisine":"italian","diets":["none"]}}'
```
