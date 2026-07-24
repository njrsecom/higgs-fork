#!/usr/bin/env node
// MCP server: generate images/video on kie.ai, with Claude as the prompting director.
//
// Tools:
//   generate_image   — text/reference -> image (default: Nano Banana Pro)
//   generate_video   — text/reference -> video (default: Kling 3.0)
//   list_models      — the current catalog from models.json
//   check_status     — poll a taskId that timed out earlier
//
// Prompt:
//   director         — loads director-prompt.md + the catalog, so any MCP client
//                      can adopt the "you describe it, Claude prompts it" workflow.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { config } from "./config.js";
import { catalog, listModels, getModel, defaultModel, type ModelDef } from "./catalog.js";
import { buildInput, type GenArgs } from "./buildInput.js";
import { generate, getStatus, type TaskResult } from "./kie.js";

const server = new McpServer({ name: "higgs-fork-kie", version: "0.1.0" });

// ---- helpers ---------------------------------------------------------------

const imageModels = listModels("image");
const videoModels = listModels("video");

function modelList(type: "image" | "video"): string {
  return (type === "image" ? imageModels : videoModels)
    .map((m) => `- ${m.id} (${m.label}): ${m.use_when}`)
    .join("\n");
}

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}
function fail(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

// Higgsfield-style one-line metadata summary: "Nano Banana Pro · 9:16 · 2k · ~$0.05/image"
function metaLine(model: ModelDef, modelId: string, input: Record<string, unknown>): string {
  const parts: string[] = [model.label];
  const aspect = input.aspect_ratio ?? input.aspectRatio ?? input.image_size;
  if (aspect && aspect !== "auto") parts.push(String(aspect));
  if (input.resolution) parts.push(String(input.resolution));
  if (input.duration) parts.push(`${input.duration}s`);
  if (input.enable_audio) parts.push("🔊 audio");
  if (input.n && Number(input.n) > 1) parts.push(`×${input.n}`);
  if (model.approx_cost) parts.push(`~${model.approx_cost.replace(/^~/, "")}`);
  // Surface the swapped id (e.g. GPT Image 2 image-to-image) so it's never hidden.
  if (modelId !== model.id) parts.push(`[${modelId}]`);
  return parts.join(" · ");
}

interface RenderMeta {
  kind: string; // "Image" | "Video"
  model: ModelDef;
  modelId: string;
  input: Record<string, unknown>;
}

function renderResult(meta: RenderMeta, res: TaskResult): string {
  const icon = meta.kind === "Video" ? "🎬" : "🎨";
  const summary = `${icon} ${metaLine(meta.model, meta.modelId, meta.input)}`;

  if (res.state === "success") {
    const lines = res.urls.length
      ? res.urls.map((u, i) => (res.urls.length > 1 ? `${i + 1}. ${u}` : u)).join("\n")
      : "(no URLs found in response — inspect raw)";
    return `${summary}\n\n${lines}`;
  }
  if (res.state === "fail") {
    return `❌ ${meta.kind} failed\n${summary}\nError: ${res.failMessage ?? "unknown error"}`;
  }
  return (
    `⏳ ${meta.kind} still processing (timed out waiting)\n${summary}\n` +
    `taskId: ${res.taskId}\n` +
    `Call check_status with this taskId to fetch the result when it's ready.`
  );
}

// ---- generate_image --------------------------------------------------------

server.tool(
  "generate_image",
  "Generate an image on kie.ai. Write a rich, specific, sensory prompt yourself — the user " +
    "describes intent casually and you turn it into a production-grade prompt. Choose the model " +
    "with the routing rules; default is Nano Banana Pro (fast, 4K, best at legible text). Use " +
    "GPT Image 2 for complex precise composition or careful edits. Set aspect_ratio from the " +
    "destination (9:16 for TikTok/Reels/Shorts, 16:9 landscape, 1:1 square). Pass hosted image " +
    "URLs in reference_image_urls for edits/reference (GPT Image 2 auto-switches to its " +
    `image-to-image variant).\n\nImage models:\n${modelList("image")}`,
  {
    prompt: z.string().describe("The full, detailed image prompt (you write this, not the user)."),
    model: z
      .string()
      .optional()
      .describe("Model id from the catalog. Omit to use the default (Nano Banana Pro)."),
    aspect_ratio: z
      .string()
      .optional()
      .describe("e.g. '9:16', '16:9', '1:1', '3:4', '4:3'. Infer from where it'll be used."),
    reference_image_urls: z
      .array(z.string())
      .optional()
      .describe("Hosted URLs of reference/edit source images."),
    quality: z.string().optional().describe("e.g. 'low' | 'medium' | 'high' (GPT Image 2)."),
    resolution: z.string().optional().describe("e.g. '1k' | '2k' | '4k' (Nano Banana Pro)."),
    count: z.number().int().min(1).max(4).optional().describe("Number of images (1-4)."),
  },
  async (args) => {
    try {
      const model = args.model ? getModel(args.model) : defaultModel("image");
      if (!model) return fail(`Unknown model "${args.model}". Use list_models to see options.`);
      if (model.type !== "image") return fail(`${model.id} is not an image model.`);

      const genArgs: GenArgs = {
        prompt: args.prompt,
        aspectRatio: args.aspect_ratio,
        referenceUrls: args.reference_image_urls,
        quality: args.quality,
        resolution: args.resolution,
        count: args.count,
      };
      const { modelId, input } = buildInput(model, genArgs);
      const res = await generate(model.endpoint, modelId, input, config.imageTimeoutMs);
      return ok(renderResult({ kind: "Image", model, modelId, input }, res));
    } catch (e) {
      return fail(`generate_image error: ${(e as Error).message}`);
    }
  },
);

// ---- generate_video --------------------------------------------------------

server.tool(
  "generate_video",
  "Generate a video on kie.ai. Write the prompt yourself — include camera movement (e.g. 'slow " +
    "push-in'), the subject's motion beats over the clip, pacing, and audio if the model supports " +
    "it. Default model is Kling 3.0 (cinematic, multi-shot, native audio). Use Seedance 2.0 for " +
    "fast realistic clips / identity consistency, Gemini Omni for polished Google quality or to " +
    "edit/extend an existing clip (pass video_url). A reference image is treated as the start " +
    `frame.\n\nVideo models:\n${modelList("video")}`,
  {
    prompt: z.string().describe("The full, detailed video prompt with motion and camera (you write this)."),
    model: z.string().optional().describe("Model id from the catalog. Omit for the default (Kling 3.0)."),
    aspect_ratio: z.string().optional().describe("'9:16' for vertical, '16:9' for landscape."),
    reference_image_urls: z
      .array(z.string())
      .optional()
      .describe("Hosted URL(s) of a start frame / reference image for image-to-video."),
    video_url: z.string().optional().describe("Source video URL to edit/extend (Gemini Omni)."),
    duration: z.number().int().optional().describe("Clip length in seconds (model-dependent)."),
  },
  async (args) => {
    try {
      const model = args.model ? getModel(args.model) : defaultModel("video");
      if (!model) return fail(`Unknown model "${args.model}". Use list_models to see options.`);
      if (model.type !== "video") return fail(`${model.id} is not a video model.`);

      const genArgs: GenArgs = {
        prompt: args.prompt,
        aspectRatio: args.aspect_ratio,
        referenceUrls: args.reference_image_urls,
        videoUrl: args.video_url,
        duration: args.duration,
      };
      const { modelId, input } = buildInput(model, genArgs);
      const res = await generate(model.endpoint, modelId, input, config.videoTimeoutMs);
      return ok(renderResult({ kind: "Video", model, modelId, input }, res));
    } catch (e) {
      return fail(`generate_video error: ${(e as Error).message}`);
    }
  },
);

// ---- list_models -----------------------------------------------------------

server.tool(
  "list_models",
  "List the available kie.ai models from the catalog (id, type, when to use, rough cost).",
  { type: z.enum(["image", "video", "audio"]).optional().describe("Filter by output type.") },
  async (args) => {
    const models = listModels(args.type);
    const text = models
      .map(
        (m) =>
          `${m.id}${m.id_image_to_image ? ` (+${m.id_image_to_image})` : ""} — ${m.label} [${m.type}]\n` +
          `  when: ${m.use_when}\n  cost: ${m.approx_cost ?? "n/a"}`,
      )
      .join("\n\n");
    return ok(text);
  },
);

// ---- check_status ----------------------------------------------------------

server.tool(
  "check_status",
  "Poll a kie.ai task by id (use when a generation timed out and returned a taskId).",
  {
    task_id: z.string().describe("The taskId returned by a generate call."),
    endpoint: z.string().optional().describe("Endpoint name from the catalog (default 'jobs')."),
  },
  async (args) => {
    try {
      const res = await getStatus(args.endpoint ?? "jobs", args.task_id);
      if (res.state === "success") {
        const lines = res.urls.length ? res.urls.join("\n") : "(no URLs found — inspect raw)";
        return ok(`✅ Task ${args.task_id} complete.\n\n${lines}`);
      }
      if (res.state === "fail") {
        return ok(`❌ Task ${args.task_id} failed: ${res.failMessage ?? "unknown error"}`);
      }
      return ok(`⏳ Task ${args.task_id} still processing. Check again shortly.`);
    } catch (e) {
      return fail(`check_status error: ${(e as Error).message}`);
    }
  },
);

// ---- director prompt -------------------------------------------------------

const directorText = readFileSync(fileURLToPath(new URL("../director-prompt.md", import.meta.url)), "utf-8");

server.prompt(
  "director",
  "Load the generation director instructions + live model catalog. Adopt this to get the " +
    "'you describe it casually, Claude writes the prompt and picks the model' workflow.",
  () => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text:
            directorText +
            "\n\n--- CATALOG (models.json) ---\n" +
            JSON.stringify(catalog, null, 2),
        },
      },
    ],
  }),
);

// ---- start -----------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe for logs (stdout is the MCP channel).
  console.error(
    `higgs-fork-kie MCP server running. ${catalog.models.length} models. ` +
      `${config.apiKey ? "KIE_API_KEY set." : "WARNING: KIE_API_KEY not set."}`,
  );
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
