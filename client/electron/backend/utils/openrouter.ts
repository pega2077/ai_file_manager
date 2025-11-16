// OpenRouter utility wrapper - Re-exports from OpenRouterProvider
// Configuration:
// - Set `openrouter.openrouterApiKey` and optional `openrouter.openrouterEndpoint` in config.json,
//   or provide env `OPENROUTER_API_KEY`.
// - Default base endpoint: https://openrouter.ai/api/v1
// - Embeddings default to the OpenRouter /embeddings API with model qwen/qwen3-embedding-0.6b.

export {
  openRouterProvider,
  embedWithOpenRouter,
  generateStructuredJsonWithOpenRouter,
  describeImageWithOpenRouter,
  normalizeJsonSchema,
} from "./OpenRouterProvider";

export type { OpenRouterEmbedRequest } from "./OpenRouterProvider";
