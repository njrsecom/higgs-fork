// Runtime config, all from env. The kie.ai key is never committed.

function num(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  apiKey: process.env.KIE_API_KEY ?? "",
  baseUrl: process.env.KIE_BASE_URL ?? "https://api.kie.ai",
  pollIntervalMs: num("POLL_INTERVAL_MS", 4000),
  imageTimeoutMs: num("IMAGE_TIMEOUT_MS", 180_000),
  videoTimeoutMs: num("VIDEO_TIMEOUT_MS", 360_000),
};

export function assertApiKey(): void {
  if (!config.apiKey) {
    throw new Error(
      "KIE_API_KEY is not set. Add it to the MCP server env (see .env.example). Get a key at https://kie.ai.",
    );
  }
}
