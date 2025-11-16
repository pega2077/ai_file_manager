// OpenAI utility wrapper - Re-exports from OpenAIProvider
// Configuration:
// - Set `openaiApiKey` and `openaiEndpoint` in config.json, or provide env `OPENAI_API_KEY`.
// - Default endpoint: https://api.openai.com/v1
// - Models are configurable via ConfigManager: `openaiModel`, `openaiEmbedModel`, `openaiVisionModel`.

export {
  openAIProvider,
  embedWithOpenAI,
  generateStructuredJsonWithOpenAI,
  describeImageWithOpenAI,
} from "./OpenAIProvider";
