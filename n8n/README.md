# n8n workflows

| File | Purpose |
| --- | --- |
| `code-a-cuisine-recipe-agent.json` | Recipe API for the Angular app: validation, IP quota, AI generation with a schema-checked output parser, responses |
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

`clientIp` and `requestedAt` are sent by the app but ignored by the workflow: the IP is taken from the Cloudflare header, which the browser cannot forge.

| Field | Rule |
| --- | --- |
| `ingredients` | 1–30 items; duplicates are merged, kg and liter are converted to g and ml first |
| `name` | 1–60 letters, numbers, spaces, hyphens, apostrophes, parentheses |
| `quantity` | a JSON number > 0 (strings are rejected) |
| `unit` | `gram`, `kg`, `ml`, `liter`, `piece` |
| `portions` | whole number 1–12 |
| `cooks` | whole number 1–3 |
| `cookingTime` | `quick` (≤ 20 min), `medium` (20–45 min), `complex` (> 45 min) |
| `cuisine` | `german`, `italian`, `indian`, `japanese`, `gourmet`, `fusion` |
| `diets` | one or more of `vegetarian`, `vegan`, `keto`, or only `none` |

### Responses

| Status | Body |
| --- | --- |
| 200 | `{ request, generatedAt, quota, result: { recipes } }` |
| 400 | `{ message, code: "INVALID_REQUEST", errors: string[] }` |
| 429 | `{ message, code: "QUOTA_EXCEEDED" \| "GLOBAL_QUOTA_EXCEEDED" \| "THROTTLED" \| "IP_NOT_DETECTED" \| "QUOTA_UNAVAILABLE", quota }` |
| 500 | `{ message, code: "RECIPE_GENERATION_FAILED", generatedAt }` |

A recipe in `result.recipes` (always 3):

```json
{
  "title": "Fresh Tomato Garlic Pasta",
  "description": "…",
  "estimatedMinutes": 20,
  "usedIngredients": ["pasta", "tomato", "garlic"],
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
2. **Check IP Quota** takes the caller IP from `cf-connecting-ip` (set by Cloudflare in front of n8n Cloud, so it cannot be forged; `x-real-ip` as fallback) and enforces
   - 3 generations per IP per calendar day (Europe/Berlin); IPv6 is counted per /64 network, users behind one shared IP share the 3,
   - 12 generations per day for the whole app,
   - 15 seconds between two requests of the same IP (throttling as cost airbag).

   Counters live in Firebase `quota/<date>/global` and `quota/<date>/ips/<hash>`: the IP is stored only as a SHA-256 hash. The database rules accept nothing but "+1" writes on these counters, so nobody can reset them, and a request that loses a race against a parallel one is rejected instead of passing twice. If Firebase cannot be read, the request is refused (fail closed).
3. **Prepare Prompt** writes the prompt and a **JSON schema with the rules of this request**: exactly 3 recipes, `usedIngredients` only from the available ingredients and at least 70 % of them, at most 3 `extraIngredients`, `estimatedMinutes` inside the chosen time frame, 4–12 steps with `cook` between 1 and the number of cooks, nutrition per portion and in total (keto: at most 20 g carbs per portion).
4. **Generate Recipes** (Basic LLM Chain with Ollama Cloud `gemma4:31b`) returns the answer through the **Structured Output Parser**, which reads the schema from `$json.recipeSchema` and validates the answer against it. Its **auto-fix** sends a broken answer back to the same model together with the parser error. A failed model call is retried once (`retryOnFail`).
5. **Shape Recipes** only formats the checked recipes for the app (step texts, per-cook step details, ingredient coverage); there is no hand-written validation loop.
6. **Log Recipe Error** writes failures of any step to the execution log and Firebase `logs/recipeErrors`; the app only gets a friendly message (500).

Every node has a description (visible under the node) and the canvas is split into sticky-note sections.

## Setup on your own n8n instance

1. **Create an instance**: n8n Cloud (`https://<name>.app.n8n.cloud/`) or self-hosted with a public HTTPS domain.
2. **Import both workflows**: Workflows → *Import from File*.
3. **AI model**: open *Ollama Cloud Chat Model* (an OpenAI Chat Model node) and create an **OpenAI** credential
   - API Key: your key from https://ollama.com/settings/keys
   - Base URL: `https://ollama.com/v1`
   - the native Ollama Chat Model node did not send the API key to Ollama Cloud (401), hence the OpenAI-compatible route
4. **Firebase**: set your Realtime Database URL in *Check IP Quota*, *Log Recipe Error* and *Format Error Report* (`const dbUrl = …`) and deploy the rules with `firebase deploy --only database`. The quota only works with these rules: they allow the "+1" writes the workflow makes without any secret.
5. **Error handling**: in *Code-a-Cuisine Error Handler* open *Send Error Email* and add an SMTP credential for the sender address (sender and recipient are set). The recipe workflow already points to it under *Settings → Error workflow*; after an import, pick *Code-a-Cuisine Error Handler* there again.
6. **Publish** the recipe workflow and set `n8nBaseUrl` in `src/environments/environment*.ts`.

## Quick test

```bash
curl -X POST https://<name>.app.n8n.cloud/webhook/code-a-cuisine-recipe \
  -H "Content-Type: application/json" \
  -d '{"ingredients":[{"name":"tomato","quantity":300,"unit":"gram"},{"name":"pasta","quantity":200,"unit":"gram"}],"preferences":{"portions":2,"cooks":2,"cookingTime":"quick","cuisine":"italian","diets":["none"]}}'
```
