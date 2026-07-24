// Loads and types models.json (the single source of truth for the model catalog).
// Both the director's routing and the adapter's request-building read from here.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface InputField {
  type: string;
  required?: boolean;
  default?: unknown;
  options?: unknown[];
  note?: string;
  min?: number;
  max?: number;
}

export interface ModelDef {
  id: string;
  id_image_to_image?: string;
  label: string;
  type: "image" | "video" | "audio";
  endpoint: string;
  id_confirmed?: boolean;
  input_verified?: boolean;
  default?: boolean;
  use_when: string;
  supports_reference_images?: boolean;
  input: Record<string, InputField>;
  approx_cost?: string;
}

export interface ApiEndpoint {
  create: string;
  poll: string;
  poll_param: string;
  body_shape?: string;
  note?: string;
}

export interface Catalog {
  provider: string;
  api: {
    base_url: string;
    auth: { header: string; format: string; note?: string };
    endpoints: Record<string, ApiEndpoint>;
    flow?: string;
  };
  models: ModelDef[];
}

// models.json lives at the repo root, one level up from this file's directory
// (src/ in dev via tsx, dist/ when compiled — both resolve to the root).
const catalogUrl = new URL("../models.json", import.meta.url);
const raw = readFileSync(fileURLToPath(catalogUrl), "utf-8");
export const catalog: Catalog = JSON.parse(raw);

export function listModels(type?: "image" | "video" | "audio"): ModelDef[] {
  return type ? catalog.models.filter((m) => m.type === type) : catalog.models;
}

export function getModel(id: string): ModelDef | undefined {
  return catalog.models.find(
    (m) => m.id === id || m.id_image_to_image === id || m.label.toLowerCase() === id.toLowerCase(),
  );
}

export function defaultModel(type: "image" | "video"): ModelDef {
  // Prefer an explicit `"default": true` in models.json so routing can't be
  // broken by reordering. Fall back to the first model of the type.
  const flagged = catalog.models.find((x) => x.type === type && x.default);
  if (flagged) return flagged;
  const m = catalog.models.find((x) => x.type === type);
  if (!m) throw new Error(`No ${type} model defined in models.json`);
  return m;
}

export function getEndpoint(name: string): ApiEndpoint {
  const ep = catalog.api.endpoints[name];
  if (!ep) throw new Error(`Unknown endpoint "${name}" in models.json`);
  return ep;
}
