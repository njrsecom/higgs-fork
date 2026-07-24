// Turns the director's high-level, model-agnostic args into the exact `input`
// object a given kie.ai model expects, driven entirely by models.json.
//
// Why: field names differ per model (image_urls vs imageUrls vs image_url, etc.),
// and some are unverified. Centralising the mapping here means fixing a field
// name is a one-line change in models.json — no code edits.

import type { ModelDef } from "./catalog.js";

export interface GenArgs {
  prompt: string;
  aspectRatio?: string;
  referenceUrls?: string[];
  videoUrl?: string;
  duration?: number;
  quality?: string;
  resolution?: string;
  count?: number;
}

// Candidate field names per concept, in priority order. The builder picks the
// first one that actually exists in the model's declared input spec.
const REFERENCE_FIELDS = ["image_urls", "imageUrls", "filesUrl", "image_url"];
const ASPECT_FIELDS = ["aspect_ratio", "aspectRatio", "image_size"];
const VIDEO_FIELDS = ["video_url", "videoUrl"];

function firstPresent(model: ModelDef, candidates: string[]): string | undefined {
  return candidates.find((c) => c in model.input);
}

/**
 * Build the `input` payload and resolve the effective model id (e.g. GPT Image 2
 * swaps to its image-to-image id when references are supplied).
 */
export function buildInput(
  model: ModelDef,
  args: GenArgs,
): { modelId: string; input: Record<string, unknown> } {
  const input: Record<string, unknown> = {};

  // 1) Start from declared defaults so required-ish fields are always present.
  for (const [name, field] of Object.entries(model.input)) {
    if (field.default !== undefined) input[name] = field.default;
  }

  // 2) Prompt is universal.
  input.prompt = args.prompt;

  // 3) Reference images -> the model's reference field.
  const hasRefs = !!args.referenceUrls?.length;
  if (hasRefs) {
    const field = firstPresent(model, REFERENCE_FIELDS);
    if (field) {
      // image_url (singular) takes one URL; the array fields take the list.
      input[field] = field === "image_url" ? args.referenceUrls![0] : args.referenceUrls;
    }
  }

  // 4) Source video (for conversational edit/extend models like Gemini Omni).
  if (args.videoUrl) {
    const field = firstPresent(model, VIDEO_FIELDS);
    if (field) input[field] = args.videoUrl;
  }

  // 5) Aspect ratio -> whichever field the model declares.
  if (args.aspectRatio) {
    const field = firstPresent(model, ASPECT_FIELDS);
    if (field) input[field] = args.aspectRatio;
  }

  // 6) Simple pass-throughs when the model supports them.
  if (args.duration !== undefined && "duration" in model.input) input.duration = args.duration;
  if (args.quality !== undefined && "quality" in model.input) input.quality = args.quality;
  if (args.resolution !== undefined && "resolution" in model.input)
    input.resolution = args.resolution;
  if (args.count !== undefined && "n" in model.input) input.n = args.count;

  // 7) Resolve the effective model id (GPT Image 2 t2i vs i2i).
  const modelId = hasRefs && model.id_image_to_image ? model.id_image_to_image : model.id;

  return { modelId, input };
}
