// Ollama utility wrapper - Re-exports from OllamaProvider
// Configuration:
// - Set `ollamaEndpoint` and optional models in config.json
// - Default endpoint is typically http://localhost:11434

export {
  ollamaProvider,
  ollamaClient,
  OllamaClient,
  trimEndpoint,
} from "./OllamaProvider";

export type {
  OllamaResolvedConfig,
  OllamaEmbedRequest,
  OllamaEmbedResponse,
  OllamaRole,
  OllamaMessage,
  StructuredResponseFormat,
  OllamaGeneratePayload,
  OllamaGenerateResponseBody,
  OllamaVisionGeneratePayload,
} from "./OllamaProvider";

export type { DescribeImageOptions } from "./llmProviderTypes";

// Re-export legacy BaseOllamaClient for backward compatibility
import { OllamaProvider } from "./OllamaProvider";
export const BaseOllamaClient = OllamaProvider;
