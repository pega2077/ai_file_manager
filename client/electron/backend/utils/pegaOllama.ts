import type { AppConfig } from "../../configManager";
import { BaseOllamaClient, type OllamaResolvedConfig } from "./ollama";

export class PegaOllamaClient extends BaseOllamaClient {
  protected readonly providerLabel = "Pega";

  protected resolveConfig(cfg: AppConfig): OllamaResolvedConfig {
    const section = cfg.pega ?? {};
    const baseEndpoint = this.trimEndpoint(section.pegaEndpoint || cfg.pegaEndpoint);
    return {
      endpoint: baseEndpoint ? `${baseEndpoint}/ollama` : "",
      chatModel: section.pegaModel || cfg.pegaModel,
      embedModel: section.pegaEmbedModel || cfg.pegaEmbedModel,
      visionModel: section.pegaVisionModel || cfg.pegaVisionModel,
      apiKey: section.pegaApiKey || cfg.pegaApiKey || section.pegaAuthToken || cfg.pegaAuthToken,
    };
  }

  protected getDefaultEmbedModel(): string {
    return "pega-embed";
  }

  protected getDefaultChatModel(): string {
    return "pega-chat";
  }

  protected getDefaultVisionModel(): string {
    return "pega-vision";
  }
}

export const pegaOllamaClient = new PegaOllamaClient();
