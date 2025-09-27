import { configManager } from "../../configManager";
import { logger } from "../../logger";
import { httpPostJson } from "./httpClient";

export type BailianRole = "system" | "user" | "assistant";

export interface BailianMessage {
  role: BailianRole;
  content: string | BailianContentPart[];
}

export type BailianContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface BailianChatCompletionRequest {
  model: string;
  messages: BailianMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: {
    type: "json_object" | "json_schema";
    json_schema?: { name?: string; schema: Record<string, unknown>; strict?: boolean };
  };
}

interface BailianChatCompletionResponse {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    index?: number;
    message?: {
      role?: BailianRole;
      content?: string | BailianContentPart[];
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface BailianEmbeddingResponse {
  model?: string;
  data?: Array<{
    index?: number;
    embedding: number[];
  }>;
  usage?: {
    prompt_tokens?: number;
    total_tokens?: number;
  };
}

const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

function normalizeJsonSchema<T>(input: T): T {
  const seen = new WeakSet<object>();
  function walk(node: unknown): unknown {
    if (!node || typeof node !== "object") return node;
    if (seen.has(node as object)) return node;
    seen.add(node as object);

    const n = node as Record<string, unknown>;
    const typeVal = typeof n.type === "string" ? String(n.type).toLowerCase() : undefined;

    if (typeVal === "object") {
      if (!Object.prototype.hasOwnProperty.call(n, "additionalProperties")) {
        (n as Record<string, unknown>).additionalProperties = false;
      }
      if (n.properties && typeof n.properties === "object") {
        const props = n.properties as Record<string, unknown>;
        for (const key of Object.keys(props)) {
          props[key] = walk(props[key]);
        }
      }
      if (n.patternProperties && typeof n.patternProperties === "object") {
        const pprops = n.patternProperties as Record<string, unknown>;
        for (const key of Object.keys(pprops)) {
          pprops[key] = walk(pprops[key]);
        }
      }
    }

    if (typeVal === "array" && n.items) {
      (n as Record<string, unknown>).items = walk(n.items);
    }

    for (const k of ["allOf", "anyOf", "oneOf", "not", "if", "then", "else"]) {
      const v = n[k as keyof typeof n];
      if (!v) continue;
      if (Array.isArray(v)) {
        (n as Record<string, unknown>)[k] = v.map((item) => walk(item));
      } else {
        (n as Record<string, unknown>)[k] = walk(v);
      }
    }

    for (const k of ["definitions", "$defs"]) {
      const v = n[k as keyof typeof n];
      if (v && typeof v === "object") {
        const defs = v as Record<string, unknown>;
        for (const key of Object.keys(defs)) {
          defs[key] = walk(defs[key]);
        }
      }
    }

    return n;
  }

  try {
    const clone = JSON.parse(JSON.stringify(input)) as unknown;
    return walk(clone) as T;
  } catch {
    return input;
  }
}

function resolveConfig() {
  const cfg = configManager.getConfig();
  const bc = cfg.bailian || {};
  const baseURL = (bc.bailianEndpoint || DEFAULT_BASE_URL).replace(/\/$/, "");
  const apiKey =
    (bc.bailianApiKey || cfg.bailianApiKey || "") || process.env.BAILIAN_API_KEY || process.env.DASHSCOPE_API_KEY || "";
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    throw new Error(
      "Bailian API key is not configured. Set bailian.bailianApiKey in config.json or provide BAILIAN_API_KEY/DASHSCOPE_API_KEY env."
    );
  }
  return {
    baseURL,
    apiKey: trimmedKey,
    model: bc.bailianModel || cfg.bailianModel || "qwen-max",
    embedModel: bc.bailianEmbedModel || cfg.bailianEmbedModel || "text-embedding-v1",
    visionModel: bc.bailianVisionModel || cfg.bailianVisionModel || bc.bailianModel || cfg.bailianModel || "qwen-vl-max",
  };
}

export async function generateStructuredJsonWithBailian(
  messages: { role: BailianRole; content: string }[],
  schema?: Record<string, unknown>,
  temperature = 0.7,
  maxTokens = 1500,
  overrideModel?: string
): Promise<unknown> {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("messages are required");
  }
  const { baseURL, apiKey, model } = resolveConfig();
  const finalModel = overrideModel || model;
  const normalizedSchema = schema ? (normalizeJsonSchema(schema) as Record<string, unknown>) : undefined;
  const requestBody: BailianChatCompletionRequest = {
    model: finalModel,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    temperature,
    max_tokens: maxTokens,
    response_format: normalizedSchema
      ? { type: "json_schema", json_schema: { name: "schema", schema: normalizedSchema, strict: true } }
      : { type: "json_object" },
  };

  const resp = await httpPostJson<BailianChatCompletionResponse>(
    `${baseURL}/chat/completions`,
    requestBody,
    { Accept: "application/json" },
    60000,
    apiKey
  );

  if (!resp.ok || !resp.data) {
    const msg = resp.error?.message || `Failed generate via Bailian: HTTP ${resp.status}`;
    logger.error("generateStructuredJsonWithBailian failed", msg);
    throw new Error(msg);
  }

  const choice = resp.data.choices?.[0]?.message?.content;
  const content = Array.isArray(choice)
    ? choice
        .map((part) => (typeof part === "string" ? part : part.type === "text" ? part.text : ""))
        .join("")
    : (choice as string | undefined) || "";

  try {
    return JSON.parse(content);
  } catch (err) {
    const match = content.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) {
      return JSON.parse(match[0]);
    }
    logger.error("Bailian response is not valid JSON", { snippet: content.slice(0, 200) });
    throw new Error("Model did not return valid JSON");
  }
}

export async function describeImageWithBailian(
  imageBase64: string,
  prompt = "What is in this picture? Describe it in detail.",
  overrideModel?: string,
  timeoutMs = 120000,
  maxTokens?: number
): Promise<string> {
  const { baseURL, apiKey, visionModel } = resolveConfig();
  const finalModel = overrideModel || visionModel;
  const requestBody: BailianChatCompletionRequest = {
    model: finalModel,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:image/png;base64,${imageBase64}` } },
        ],
      },
    ],
    temperature: 0.2,
    max_tokens: typeof maxTokens === 'number' && maxTokens > 0 ? maxTokens : 800,
  };

  const resp = await httpPostJson<BailianChatCompletionResponse>(
    `${baseURL}/chat/completions`,
    requestBody,
    { Accept: "application/json" },
    timeoutMs,
    apiKey
  );

  if (!resp.ok || !resp.data) {
    const msg = resp.error?.message || `Failed vision generate via Bailian: HTTP ${resp.status}`;
    logger.error("describeImageWithBailian failed", msg);
    throw new Error(msg);
  }

  const choice = resp.data.choices?.[0]?.message?.content;
  if (Array.isArray(choice)) {
    return choice
      .map((part) => (typeof part === "string" ? part : part.type === "text" ? part.text : ""))
      .join("")
      .trim();
  }
  return typeof choice === "string" ? choice.trim() : "";
}

export async function embedWithBailian(inputs: string[], overrideModel?: string): Promise<number[][]> {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    return [];
  }
  const { baseURL, apiKey, embedModel } = resolveConfig();
  const model = overrideModel || embedModel;
  const resp = await httpPostJson<BailianEmbeddingResponse>(
    `${baseURL}/embeddings`,
    { model, input: inputs },
    { Accept: "application/json" },
    60000,
    apiKey
  );

  if (!resp.ok || !resp.data) {
    const msg = resp.error?.message || `Failed embedding via Bailian: HTTP ${resp.status}`;
    logger.error("embedWithBailian failed", msg);
    throw new Error(msg);
  }

  const items = resp.data.data;
  if (!items || !Array.isArray(items)) {
    throw new Error("Invalid embedding response from Bailian");
  }

  return items.map((item) => {
    if (!item.embedding || !Array.isArray(item.embedding)) {
      throw new Error("Invalid embedding vector in Bailian response");
    }
    return item.embedding;
  });
}
