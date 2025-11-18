/**
 * Common types and interfaces for LLM providers
 */

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { SupportedLang } from "./promptHelper";

/** Minimum completion tokens to keep JSON outputs intact */
export const MIN_JSON_COMPLETION_TOKENS = 3072;

/**
 * Unified configuration structure resolved from AppConfig
 */
export interface ProviderResolvedConfig {
  /** API endpoint/base URL */
  endpoint?: string;
  baseUrl?: string;
  /** API key for authentication */
  apiKey?: string;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
  /** Default chat/completion model */
  chatModel?: string;
  /** Default embedding model */
  embedModel?: string;
  /** Default vision/multimodal model */
  visionModel?: string;
  /** Additional HTTP headers */
  headers?: Record<string, string>;
}

/**
 * Parameters for structured JSON generation
 */
export interface GenerateStructuredJsonParams {
  /** Chat messages */
  messages: ChatCompletionMessageParam[];
  /** JSON schema for response format */
  responseFormat?: {
    json_schema?: {
      name?: string;
      schema: unknown;
      strict?: boolean;
    };
  };
  /** Temperature for generation (0-1) */
  temperature?: number;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Override the default model */
  overrideModel?: string;
  /** Language for prompts */
  language?: SupportedLang;
}

/**
 * Options for image description
 */
export interface DescribeImageOptions {
  /** Prompt/question about the image */
  prompt?: string;
  /** Override the default model */
  overrideModel?: string;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
  /** Maximum tokens to generate */
  maxTokens?: number;
}
