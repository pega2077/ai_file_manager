/**
 * LLM Provider Factory
 * Manages provider instantiation and registration
 */

import { BaseLLMProvider } from "./BaseLLMProvider";
import { openAIProvider } from "./OpenAIProvider";
import { openRouterProvider } from "./OpenRouterProvider";
import { ollamaProvider } from "./OllamaProvider";
import { llamaCppProvider } from "./LlamaCppProvider";
import { bailianProvider } from "./BailianProvider";

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
    this.register("bailian", bailianProvider);
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

  /**
   * Check health of a specific provider
   */
  public async checkProviderHealth(type: ProviderType): Promise<boolean> {
    const provider = this.getProvider(type);
    return provider.checkServiceHealth();
  }

  /**
   * Check health of all registered providers
   */
  public async checkAllProvidersHealth(): Promise<Map<ProviderType, boolean>> {
    const results = new Map<ProviderType, boolean>();
    const promises = Array.from(this.providers.entries()).map(async ([type, provider]) => {
      try {
        const isHealthy = await provider.checkServiceHealth();
        results.set(type, isHealthy);
      } catch (error) {
        results.set(type, false);
      }
    });
    
    await Promise.all(promises);
    return results;
  }
}

// Export singleton factory instance
export const providerFactory = new LLMProviderFactory();
