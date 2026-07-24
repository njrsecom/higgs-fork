// kie.ai unified Jobs API adapter: create a task, poll it, extract media URLs.
//
// Endpoints (from models.json):
//   POST /api/v1/jobs/createTask   body { model, input }  -> { data: { taskId } }
//   GET  /api/v1/jobs/recordInfo?taskId=...               -> { data: { state, resultJson, ... } }
//
// kie's response envelopes vary slightly across models, so parsing is defensive:
// we look for the task id and result URLs in several known locations.

import { config, assertApiKey } from "./config.js";
import { getEndpoint } from "./catalog.js";

export type TaskState = "pending" | "success" | "fail";

export interface TaskResult {
  taskId: string;
  state: TaskState;
  urls: string[];
  raw: unknown;
  failMessage?: string;
}

interface EndpointPaths {
  createPath: string;
  pollPath: string;
  pollParam: string;
}

function endpointPaths(name: string): EndpointPaths {
  const ep = getEndpoint(name);
  // Stored as "POST /api/v1/..." — strip the verb.
  return {
    createPath: ep.create.replace(/^\w+\s+/, ""),
    pollPath: ep.poll.replace(/^\w+\s+/, ""),
    pollParam: ep.poll_param,
  };
}

async function apiFetch(path: string, init: RequestInit): Promise<any> {
  const res = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`kie.ai returned non-JSON (${res.status}): ${text.slice(0, 300)}`);
  }
  if (!res.ok) {
    const msg = json?.message ?? json?.msg ?? res.statusText;
    throw new Error(`kie.ai ${res.status}: ${msg}`);
  }
  // kie wraps errors in a 200 with a non-200 `code` too.
  const code = json?.code;
  if (code !== undefined && code !== 200 && code !== 0) {
    throw new Error(`kie.ai error code ${code}: ${json?.message ?? json?.msg ?? "unknown"}`);
  }
  return json;
}

function extractTaskId(json: any): string {
  const id =
    json?.data?.taskId ??
    json?.data?.task_id ??
    json?.data?.id ??
    json?.taskId ??
    json?.task_id;
  if (!id) throw new Error(`Could not find taskId in kie.ai response: ${JSON.stringify(json).slice(0, 300)}`);
  return String(id);
}

function extractUrls(data: any): string[] {
  if (!data) return [];
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && /^https?:\/\//.test(v)) out.push(v);
    else if (Array.isArray(v)) v.forEach(push);
  };

  // resultJson is often a JSON string containing { resultUrls: [...] }.
  if (typeof data.resultJson === "string") {
    try {
      const parsed = JSON.parse(data.resultJson);
      push(parsed?.resultUrls);
      push(parsed?.urls);
      push(parsed?.videoUrl);
      push(parsed?.imageUrl);
      push(parsed?.imageUrls);
    } catch {
      /* ignore */
    }
  }

  push(data.resultUrls);
  push(data.urls);
  push(data.videoUrl);
  push(data.imageUrl);
  push(data.imageUrls);
  push(data.response?.resultUrls);
  push(data.result?.resultUrls);
  push(data.result?.urls);

  return [...new Set(out)];
}

function readState(data: any): TaskState {
  const s = String(data?.state ?? data?.status ?? "").toLowerCase();
  const flag = data?.successFlag ?? data?.success_flag;
  if (s === "success" || s === "completed" || s === "succeed" || flag === 1) return "success";
  if (s === "fail" || s === "failed" || s === "error" || flag === 2 || flag === 3)
    return "fail";
  return "pending";
}

/** Submit a generation task. Returns the taskId. */
export async function createTask(endpoint: string, model: string, input: Record<string, unknown>): Promise<string> {
  assertApiKey();
  const { createPath } = endpointPaths(endpoint);
  const json = await apiFetch(createPath, {
    method: "POST",
    body: JSON.stringify({ model, input }),
  });
  return extractTaskId(json);
}

/** Fetch the current status of a task (single poll). */
export async function getStatus(endpoint: string, taskId: string): Promise<TaskResult> {
  assertApiKey();
  const { pollPath, pollParam } = endpointPaths(endpoint);
  const json = await apiFetch(`${pollPath}?${pollParam}=${encodeURIComponent(taskId)}`, {
    method: "GET",
  });
  const data = json?.data ?? json;
  const state = readState(data);
  return {
    taskId,
    state,
    urls: state === "success" ? extractUrls(data) : [],
    failMessage: data?.failMsg ?? data?.fail_msg ?? data?.failReason ?? undefined,
    raw: data,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Create a task and poll until it finishes or the timeout is hit.
 * On timeout, returns a still-pending TaskResult (the taskId can be checked later
 * with the check_status tool).
 */
export async function generate(
  endpoint: string,
  model: string,
  input: Record<string, unknown>,
  timeoutMs: number,
): Promise<TaskResult> {
  const taskId = await createTask(endpoint, model, input);
  const deadline = Date.now() + timeoutMs;

  // Small initial delay before first poll — generation never returns instantly.
  await sleep(Math.min(config.pollIntervalMs, 1500));

  while (Date.now() < deadline) {
    const status = await getStatus(endpoint, taskId);
    if (status.state === "success" || status.state === "fail") return status;
    await sleep(config.pollIntervalMs);
  }
  return { taskId, state: "pending", urls: [], raw: null };
}
