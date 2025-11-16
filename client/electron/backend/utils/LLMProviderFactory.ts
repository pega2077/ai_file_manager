/**
 * LLM Provider Factory
 * Manages provider instantiation and registration
 */

import { BaseLLMProvider } from "./BaseLLMProvider";
import { openAIProvider } from "./OpenAIProvider";
import { openRouterProvider } from "./OpenRouterProvider";
import { ollamaProvider } from "./OllamaProvider";
import { llamaCppProvider } from "./LlamaCppProvider";

export type ProviderType = "openai" | "azure-openai" | "openrouter" | "ollama" | "bailian" | "pega" | "llamacpp";

/**
 * Provider factory registry
 */
class LLMProviderFactory {
  private providers = new Map<ProviderType, BaseLLMProvider>();

  constructor() {
    // Register built-in providers
    this.register("openai", openAIProvider);
    this.register("azure-openai", openAIProvider); // OpenAI handles Azure-compatible endpoints
    this.register("openrouter", openRouterProvider);
    this.register("ollama", ollamaProvider);
    this.register("llamacpp", llamaCppProvider);
  }

  /**
   * Register a provider instance
   */
  public register(type: ProviderType, provider: BaseLLMProvider): void {
    this.providers.set(type, provider);
  }

  /**
   * Get provider instance by type
   */
  public getProvider(type: ProviderType): BaseLLMProvider {
    const provider = this.providers.get(type);
    if (!provider) {
      throw new Error(`Provider type '${type}' is not registered`);
    }
    return provider;
  }

  /**
   * Check if a provider type is registered
   */
  public hasProvider(type: ProviderType): boolean {
    return this.providers.has(type);
  }

  /**
   * Get all registered provider types
   */
  public getRegisteredTypes(): ProviderType[] {
    return Array.from(this.providers.keys());
  }
}

// Export singleton factory instance
export const providerFactory = new LLMProviderFactory();
