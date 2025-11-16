import { configManager } from "../../configManager";
import type { SupportedLang } from "./promptHelper";
import {
  ollamaClient,
  type StructuredResponseFormat,
  type OllamaMessage,
  type DescribeImageOptions,
} from "./ollama";
import { pegaOllamaClient } from "./pegaOllama";
import {
  embedWithOpenAI,
  generateStructuredJsonWithOpenAI,
  describeImageWithOpenAI,
} from "./openai";
import {
  generateStructuredJsonWithOpenRouter,
  describeImageWithOpenRouter,
  embedWithOpenRouter,
} from "./openrouter";
import {
  embedWithPegaOpenRouter,
  generateStructuredJsonWithPegaOpenRouter,
  describeImageWithPegaOpenRouter,
} from "./pegaOpenrouter";
import {
  embedWithBailian,
  generateStructuredJsonWithBailian,
  describeImageWithBailian,
} from "./bailian";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { MIN_JSON_COMPLETION_TOKENS } from "./llmProviderTypes";

export type LlmMessage = OllamaMessage; // role + string content

export type LlmTask = "chat" | "embed" | "vision";

export type ProviderName = "ollama" | "openai" | "azure-openai" | "openrouter" | "bailian" | "pega";

function getPegaMode(): "ollama" | "openrouter" {
  const cfg = configManager.getConfig();
  const nested = cfg.pega?.pegaMode;
  return nested === "openrouter" ? "openrouter" : "ollama";
}

export function getActiveProvider(): ProviderName {
  const cfg = configManager.getConfig();
  const p = cfg.llmProvider || "ollama";
  if (p === "openai" || p === "azure-openai" || p === "openrouter" || p === "bailian" || p === "pega") {
    return p;
  }
  return "ollama";
}

export function getActiveModelName(task: LlmTask, providerOverride?: ProviderName): string {
  const cfg = configManager.getConfig();
  const provider = providerOverride || getActiveProvider();
  if (provider === "openai" || provider === "azure-openai") {
    const oc = cfg.openai || {};
    if (task === "embed") return oc.openaiEmbedModel || cfg.openaiEmbedModel || "";
    if (task === "vision") return oc.openaiVisionModel || oc.openaiModel || cfg.openaiVisionModel || cfg.openaiModel || "";
    return oc.openaiModel || cfg.openaiModel || "";
  }
  if (provider === "openrouter") {
    const oc = cfg.openrouter || {};
    // Embedding for OpenRouter uses separate endpoint; still expose model for UI/readouts
    if (task === "embed") return oc.openrouterEmbedModel || "";
    if (task === "vision") return oc.openrouterVisionModel || oc.openrouterModel || "";
    return oc.openrouterModel || "";
  }
  if (provider === "bailian") {
    const bc = cfg.bailian || {};
    if (task === "embed") return bc.bailianEmbedModel || cfg.bailianEmbedModel || "";
    if (task === "vision") return bc.bailianVisionModel || bc.bailianModel || cfg.bailianVisionModel || cfg.bailianModel || "";
    return bc.bailianModel || cfg.bailianModel || "";
  }
  if (provider === "pega") {
    const pc = cfg.pega || {};
    const mode = getPegaMode();
    if (task === "embed") {
      return pc.pegaEmbedModel || cfg.pegaEmbedModel || "";
    }
    if (mode === "openrouter") {
      if (task === "vision") {
        return (
          pc.pegaOpenrouterVisionModel ||
          pc.pegaVisionModel ||
          cfg.pegaOpenrouterVisionModel ||
          cfg.pegaVisionModel ||
          pc.pegaOpenrouterModel ||
          pc.pegaModel ||
          cfg.pegaOpenrouterModel ||
          cfg.pegaModel ||
          ""
        );
      }
      return (
        pc.pegaOpenrouterModel ||
        cfg.pegaOpenrouterModel ||
        pc.pegaModel ||
        cfg.pegaModel ||
        ""
      );
    }
    if (task === "vision") {
      return pc.pegaVisionModel || pc.pegaModel || cfg.pegaVisionModel || cfg.pegaModel || "";
    }
    return pc.pegaModel || cfg.pegaModel || "";
  }
  // default to ollama
  const oc = cfg.ollama || {};
  if (task === "embed") return oc.ollamaEmbedModel || cfg.ollamaEmbedModel || "";
  if (task === "vision") return oc.ollamaVisionModel || oc.ollamaModel || cfg.ollamaVisionModel || cfg.ollamaModel || "";
  return oc.ollamaModel || cfg.ollamaModel || "";
}

export async function embedText(inputs: string[], overrideModel?: string): Promise<number[][]> {
  const provider = getActiveProvider();
  if (provider === "openai" || provider === "azure-openai") {
    return embedWithOpenAI(inputs, overrideModel);
  }
  if (provider === "openrouter") {
    return embedWithOpenRouter(inputs, overrideModel);
  }
  if (provider === "bailian") {
    return embedWithBailian(inputs, overrideModel);
  }
  if (provider === "pega") {
    return getPegaMode() === "openrouter"
      ? embedWithPegaOpenRouter(inputs, overrideModel)
      : pegaOllamaClient.embed(inputs, overrideModel);
  }
  return ollamaClient.embed(inputs, overrideModel);
}

export async function generateStructuredJson(
  messages: LlmMessage[],
  responseFormat?: StructuredResponseFormat,
  temperature = 0.7,
  maxTokens = MIN_JSON_COMPLETION_TOKENS,
  overrideModel = "",
  lang?: SupportedLang,
  providerOverride?: ProviderName
): Promise<unknown> {
  const provider = providerOverride || getActiveProvider();
  console.log(`generateStructuredJson called with provider: ${provider}`);
  const tokenBudget = Math.max(maxTokens, MIN_JSON_COMPLETION_TOKENS);

  if (provider === "openai" || provider === "azure-openai") {
    // Map to OpenAI message format (string content only)
    const oaMessages = messages.map((m) => ({ role: m.role, content: m.content }));
    const schema = responseFormat?.json_schema?.schema as Record<string, unknown> | undefined;
    return generateStructuredJsonWithOpenAI(oaMessages, schema, temperature, tokenBudget, overrideModel || undefined);
  }
  if (provider === "openrouter") {
    const oaMessages = messages.map((m) => ({ role: m.role, content: m.content }));
    const schema = responseFormat?.json_schema?.schema as Record<string, unknown> | undefined;
    return generateStructuredJsonWithOpenRouter(oaMessages, schema, temperature, tokenBudget, overrideModel || undefined);
  }
  if (provider === "bailian") {
    const oaMessages = messages.map((m) => ({ role: m.role, content: m.content }));
    const schema = responseFormat?.json_schema?.schema as Record<string, unknown> | undefined;
    return generateStructuredJsonWithBailian(oaMessages, schema, temperature, tokenBudget, overrideModel || undefined);
  }
  if (provider === "pega") {
    if (getPegaMode() === "openrouter") {
      const oaMessages: ChatCompletionMessageParam[] = messages.map((m) => ({ role: m.role, content: m.content }));
      const schema = responseFormat?.json_schema?.schema as Record<string, unknown> | undefined;
      return generateStructuredJsonWithPegaOpenRouter(
        oaMessages,
        schema,
        temperature,
        tokenBudget,
        overrideModel || undefined
      );
    }
    return pegaOllamaClient.generateStructuredJson(
      messages,
      responseFormat,
      temperature,
      tokenBudget,
      overrideModel,
      lang
    );
  }
  return ollamaClient.generateStructuredJson(
    messages,
    responseFormat,
    temperature,
    tokenBudget,
    overrideModel,
    lang
  );
}

export async function describeImage(
  imageBase64: string | string[],
  options?: {
    prompt?: string;
    overrideModel?: string;
    timeoutMs?: number;
    maxTokens?: number;
    providerOverride?: ProviderName;
  }
): Promise<string> {
  const provider = options?.providerOverride || getActiveProvider();
  if (provider === "openai" || provider === "azure-openai") {
    const img = Array.isArray(imageBase64) ? imageBase64[0] : imageBase64;
    return describeImageWithOpenAI(img, options?.prompt, options?.overrideModel, options?.maxTokens);
  }
  if (provider === "openrouter") {
    const img = Array.isArray(imageBase64) ? imageBase64[0] : imageBase64;
    return describeImageWithOpenRouter(img, options?.prompt, options?.overrideModel, options?.maxTokens);
  }
  if (provider === "bailian") {
    const img = Array.isArray(imageBase64) ? imageBase64[0] : imageBase64;
    return describeImageWithBailian(img, options?.prompt, options?.overrideModel, options?.timeoutMs, options?.maxTokens);
  }
  const imgs = Array.isArray(imageBase64) ? imageBase64 : [imageBase64];
  const describeOptions: DescribeImageOptions | undefined = options
    ? {
        prompt: options.prompt,
        overrideModel: options.overrideModel,
        timeoutMs: options.timeoutMs,
        maxTokens: options.maxTokens,
      }
    : undefined;
  if (provider === "pega") {
    if (getPegaMode() === "openrouter") {
      const img = imgs[0];
      return describeImageWithPegaOpenRouter(
        img,
        options?.prompt,
        options?.overrideModel,
        options?.maxTokens
      );
    }
    return pegaOllamaClient.describeImage(imgs, describeOptions);
  }
  return ollamaClient.describeImage(imgs, describeOptions);
}
