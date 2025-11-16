import type { AppConfig } from "../../configManager";
import { OllamaClient, type OllamaResolvedConfig } from "./OllamaProvider";

const trimEndpoint = (value?: string): string => (value ?? "").replace(/\/+$/, "");

export class PegaOllamaClient extends OllamaClient {
  // Use a more specific readonly modifier to allow this override
  protected readonly providerLabel: string = "Pega";

  protected resolveConfig(cfg: AppConfig): OllamaResolvedConfig {
    const section = cfg.pega ?? {};
    const baseEndpoint = trimEndpoint(section.pegaEndpoint || cfg.pegaEndpoint);
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
