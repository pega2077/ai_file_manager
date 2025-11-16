/**
 * Base abstract class for LLM providers
 * Encapsulates common logic for configuration parsing, input validation,
 * logging, API request scheduling, response parsing, and error handling
 */

import type { AppConfig } from "../../configManager";
import { logger } from "../../logger";
import type {
  ProviderResolvedConfig,
  GenerateStructuredJsonParams,
  DescribeImageOptions,
} from "./llmProviderTypes";

export abstract class BaseLLMProvider {
  /**
   * Provider label for logging and error messages
   */
  protected abstract readonly providerLabel: string;

  /**
   * Resolve provider-specific configuration from AppConfig
   */
  protected abstract resolveConfig(cfg: AppConfig): ProviderResolvedConfig;

  /**
   * Get default embedding model name
   */
  protected abstract getDefaultEmbedModel(): string;

  /**
   * Get default chat/completion model name
   */
  protected abstract getDefaultChatModel(): string;

  /**
   * Get default vision/multimodal model name
   */
  protected abstract getDefaultVisionModel(): string;

  /**
   * Generate text embeddings for input strings
   */
  public abstract embed(inputs: string[], overrideModel?: string): Promise<number[][]>;

  /**
   * Generate structured JSON response
   */
  public abstract generateStructuredJson(params: GenerateStructuredJsonParams): Promise<unknown>;

  /**
   * Describe image(s) using vision model
   */
  public abstract describeImage(images: string[], options?: DescribeImageOptions): Promise<string>;

  /**
   * Validate inputs are non-empty
   */
  protected validateInputs(inputs: string[], operation: string): void {
    if (!Array.isArray(inputs) || inputs.length === 0) {
      throw new Error(`${operation}: inputs must be a non-empty array`);
    }
  }

  /**
   * Build HTTP headers for API requests
   */
  protected buildHeaders(config: ProviderResolvedConfig, additionalHeaders?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(config.headers || {}),
      ...(additionalHeaders || {}),
    };

    if (config.apiKey) {
      headers.Authorization = `Bearer ${config.apiKey}`;
    }

    return headers;
  }

  /**
   * Handle HTTP errors with unified logging
   */
  protected handleHttpError(url: string, status: number, message: string, context?: Record<string, unknown>): never {
    logger.error(`${this.providerLabel} request failed`, {
      url,
      status,
      message,
      ...context,
    });
    throw new Error(message);
  }

  /**
   * Normalize JSON schema by ensuring additionalProperties: false for object types
   * Required for providers like OpenAI/OpenRouter with strict mode
   */
  protected normalizeJsonSchema<T>(input: T): T {
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

      if (typeVal === "array") {
        if (n.items) (n as Record<string, unknown>).items = walk(n.items);
      }

      for (const k of ["allOf", "anyOf", "oneOf", "not", "if", "then", "else"]) {
        const v = n[k as keyof typeof n];
        if (v) {
          if (Array.isArray(v)) (n as Record<string, unknown>)[k] = v.map((s) => walk(s));
          else (n as Record<string, unknown>)[k] = walk(v);
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

  /**
   * Try to parse JSON from raw string, extracting JSON objects/arrays if needed
   */
  protected tryParseJson(raw: string): Record<string, unknown> | undefined {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      const match = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (!match) {
        return undefined;
      }
      try {
        return JSON.parse(match[0]) as Record<string, unknown>;
      } catch {
        return undefined;
      }
    }
  }
}

/**
 * Standalone normalizeJsonSchema function for backward compatibility
 * Ensures additionalProperties: false for object types in JSON schemas
 */
export function normalizeJsonSchema<T>(input: T): T {
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

    if (typeVal === "array") {
      if (n.items) (n as Record<string, unknown>).items = walk(n.items);
    }

    for (const k of ["allOf", "anyOf", "oneOf", "not", "if", "then", "else"]) {
      const v = n[k as keyof typeof n];
      if (v) {
        if (Array.isArray(v)) (n as Record<string, unknown>)[k] = v.map((s) => walk(s));
        else (n as Record<string, unknown>)[k] = walk(v);
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
