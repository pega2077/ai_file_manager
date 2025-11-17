// llama_server utility wrapper - Re-exports from LlamaServerProvider
// Configuration:
// - Set `llamaServerEndpoint` to your llama_server instance (e.g., http://localhost:8080)
// - Optional API key if authentication is required
// - Configure models for chat, embedding, and vision tasks

export {
  llamaServerProvider,
  LlamaServerProvider,
  trimEndpoint,
} from "./LlamaServerProvider";

export type {
  LlamaServerResolvedConfig,
} from "./LlamaServerProvider";

export type { DescribeImageOptions } from "./llmProviderTypes";

// Export client as alias for backward compatibility
import { LlamaServerProvider } from "./LlamaServerProvider";
export const LlamaServerClient = LlamaServerProvider;
export const llamaServerClient = llamaServerProvider;
