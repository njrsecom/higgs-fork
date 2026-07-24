# higgs-fork

A Higgsfield-style AI generation setup powered by the **[kie.ai](https://kie.ai) API** —
faster and cheaper than Higgsfield's backend — with **Claude as the prompting brain**.

The whole idea: you describe what you want in plain language, Claude writes the
production-grade prompt and picks the right model + parameters, and the generation runs on
kie.ai. You never have to hand-write a prompt.

## Why this exists

Using Higgsfield through its Claude MCP, the thing that's actually valuable isn't Higgsfield's
UI — it's **Claude turning intent into a great prompt**. Higgsfield is just the (expensive)
backend running the job. This project keeps the Claude-does-the-prompting workflow and swaps the
backend for kie.ai.

Turns out Higgsfield gives Claude almost **no** prompt-writing instructions — the prompt prose
is Claude's own ability. What Higgsfield injects is *model routing* and *parameter guidance*.
So that's what we reproduce here, in two plain files.

## The two foundation files

| File | What it is |
|------|-----------|
| **`director-prompt.md`** | The system prompt that makes Claude a "generation director": how to write image/video prompts, which model to pick for which intent, how to set params. This is the prompting brain. |
| **`models.json`** | The kie.ai model catalog + routing map: model IDs, endpoints, input params, `use_when` guidance, and rough cost. Single source of truth for both the director and the API adapter. |

Together these *are* the Higgsfield-grade prompting layer — the rest is plumbing.

## Architecture (planned)

The same core (a kie.ai adapter + these two files) powers two front-ends:

```
        kie.ai adapter  (createTask -> poll -> media url)
              |   reads models.json
      ┌───────┴────────┐
  MCP server        Fork web app
  (Claude Desktop)  (embedded Claude via Anthropic API)
  — you're already  — standalone product; the app calls
    there, $0 LLM      Claude to direct generation
```

- **kie.ai unified Jobs API:** `POST /api/v1/jobs/createTask` with `{ model, input }`, then
  poll `GET /api/v1/jobs/recordInfo?taskId=...`. Veo has a dedicated route. See `models.json`.
- **Bring-your-own-key:** the kie.ai key comes from `KIE_API_KEY` (never committed).

## Quick start (MCP server)

```bash
npm install
npm run build
cp .env.example .env   # then put your kie.ai key in KIE_API_KEY
```

Get a key at [kie.ai](https://kie.ai). The key is read from `KIE_API_KEY` and is never committed.

### Use it from Claude Desktop

Add to `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "higgs-fork-kie": {
      "command": "node",
      "args": ["/absolute/path/to/higgs-fork/dist/index.js"],
      "env": { "KIE_API_KEY": "your_kie_ai_api_key_here" }
    }
  }
}
```

Restart Claude Desktop. Then just talk: *"make a cosy overhead shot of someone painting, for
a TikTok."* Claude writes the full prompt, picks the model, sets 9:16, and calls the tool.
Load the **director** prompt for the full routing/craft guidance in any session.

### Tools exposed

| Tool | What it does |
|------|--------------|
| `generate_image` | text/reference → image (default: Nano Banana Pro) |
| `generate_video` | text/reference → video (default: Kling 3.0) |
| `list_models` | the current catalog from `models.json` |
| `check_status` | poll a `taskId` that timed out earlier |

`director` is also registered as an MCP **prompt** (loads `director-prompt.md` + the live catalog).

## Roadmap

- [x] Director system prompt (`director-prompt.md`)
- [x] Model catalog / routing map (`models.json`)
- [x] kie.ai adapter: `createTask` + poll, per-model request building (`src/kie.ts`, `src/buildInput.ts`)
- [x] MCP server wrapping the adapter (`generate_image`, `generate_video`, `list_models`, `check_status`)
- [ ] Verify `input` field names against a live key (fields marked `input_verified: false` in `models.json`)
- [ ] Web app with embedded Claude director
- [ ] Workflow recipes (explainer, UGC ad, thumbnail) — optional, added over time

## Status

The MCP server is built and boots (4 tools + director prompt over 5 models). It needs a real
`KIE_API_KEY` to generate; the one remaining verification is confirming per-model `input` field
names against the live API (a one-line-per-field fix in `models.json` if any differ).
