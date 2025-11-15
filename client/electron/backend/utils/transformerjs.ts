import { configManager } from "../../configManager";
import { logger } from "../../logger";
import { pipeline, env } from "@xenova/transformers";

// Configure transformers.js to use local cache
env.allowLocalModels = true;
env.allowRemoteModels = true;

export interface TransformerjsConfig {
  chatModel?: string;
  embedModel?: string;
  visionModel?: string;
  cacheDir?: string;
}

let embeddingPipeline: any = null;
let textGenerationPipeline: any = null;
let imageToTextPipeline: any = null;

function resolveConfig(): TransformerjsConfig {
  const cfg = configManager.getConfig();
  const tc = cfg.transformerjs || {};
  
  return {
    chatModel: tc.transformerjsChatModel || cfg.transformerjsChatModel || "Xenova/LaMini-Flan-T5-783M",
    embedModel: tc.transformerjsEmbedModel || cfg.transformerjsEmbedModel || "Xenova/all-MiniLM-L6-v2",
    visionModel: tc.transformerjsVisionModel || cfg.transformerjsVisionModel || "Xenova/vit-gpt2-image-captioning",
    cacheDir: tc.transformerjsCacheDir || cfg.transformerjsCacheDir,
  };
}

async function getEmbeddingPipeline(model?: string) {
  const config = resolveConfig();
  const modelName = model || config.embedModel || "Xenova/all-MiniLM-L6-v2";
  
  if (embeddingPipeline && embeddingPipeline.model?.name === modelName) {
    return embeddingPipeline;
  }
  
  logger.info(`Loading transformerjs embedding model: ${modelName}`);
  
  try {
    embeddingPipeline = await pipeline("feature-extraction", modelName, {
      progress_callback: (progress: any) => {
        if (progress.status === "progress") {
          logger.info(`Model download: ${progress.file} - ${Math.round((progress.loaded / progress.total) * 100)}%`);
        }
      },
    });
    embeddingPipeline.model = { name: modelName };
    return embeddingPipeline;
  } catch (e) {
    logger.error(`Failed to load embedding model ${modelName}`, e);
    throw new Error(`Failed to load transformerjs embedding model: ${modelName}`);
  }
}

async function getTextGenerationPipeline(model?: string) {
  const config = resolveConfig();
  const modelName = model || config.chatModel || "Xenova/LaMini-Flan-T5-783M";
  
  if (textGenerationPipeline && textGenerationPipeline.model?.name === modelName) {
    return textGenerationPipeline;
  }
  
  logger.info(`Loading transformerjs text generation model: ${modelName}`);
  
  try {
    textGenerationPipeline = await pipeline("text2text-generation", modelName, {
      progress_callback: (progress: any) => {
        if (progress.status === "progress") {
          logger.info(`Model download: ${progress.file} - ${Math.round((progress.loaded / progress.total) * 100)}%`);
        }
      },
    });
    textGenerationPipeline.model = { name: modelName };
    return textGenerationPipeline;
  } catch (e) {
    logger.error(`Failed to load text generation model ${modelName}`, e);
    throw new Error(`Failed to load transformerjs text generation model: ${modelName}`);
  }
}

async function getImageToTextPipeline(model?: string) {
  const config = resolveConfig();
  const modelName = model || config.visionModel || "Xenova/vit-gpt2-image-captioning";
  
  if (imageToTextPipeline && imageToTextPipeline.model?.name === modelName) {
    return imageToTextPipeline;
  }
  
  logger.info(`Loading transformerjs image-to-text model: ${modelName}`);
  
  try {
    imageToTextPipeline = await pipeline("image-to-text", modelName, {
      progress_callback: (progress: any) => {
        if (progress.status === "progress") {
          logger.info(`Model download: ${progress.file} - ${Math.round((progress.loaded / progress.total) * 100)}%`);
        }
      },
    });
    imageToTextPipeline.model = { name: modelName };
    return imageToTextPipeline;
  } catch (e) {
    logger.error(`Failed to load image-to-text model ${modelName}`, e);
    throw new Error(`Failed to load transformerjs image-to-text model: ${modelName}`);
  }
}

export async function embedWithTransformerjs(inputs: string[], overrideModel?: string): Promise<number[][]> {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    return [];
  }
  
  try {
    const pipe = await getEmbeddingPipeline(overrideModel);
    const embeddings: number[][] = [];
    
    for (const text of inputs) {
      const output = await pipe(text, { pooling: "mean", normalize: true });
      // Convert tensor to array
      const embedding = Array.from(output.data) as number[];
      embeddings.push(embedding);
    }
    
    logger.info(`Generated ${embeddings.length} embeddings with transformerjs`);
    return embeddings;
  } catch (e) {
    logger.error("embedWithTransformerjs failed", e);
    throw e;
  }
}

export async function generateStructuredJsonWithTransformerjs(
  messages: { role: string; content: string }[],
  schema?: Record<string, unknown>,
  temperature = 0.7,
  maxTokens = 1500,
  overrideModel?: string
): Promise<unknown> {
  try {
    const pipe = await getTextGenerationPipeline(overrideModel);
    
    // Combine messages into a single prompt
    const prompt = messages
      .map((m) => {
        if (m.role === "system") return `System: ${m.content}`;
        if (m.role === "user") return `User: ${m.content}`;
        if (m.role === "assistant") return `Assistant: ${m.content}`;
        return m.content;
      })
      .join("\n");
    
    // Add JSON instruction if schema is provided
    let fullPrompt = prompt;
    if (schema) {
      fullPrompt = `${prompt}\n\nPlease respond with a valid JSON object that matches this schema: ${JSON.stringify(schema, null, 2)}`;
    }
    
    const output = await pipe(fullPrompt, {
      max_new_tokens: maxTokens,
      temperature: temperature,
      do_sample: temperature > 0,
    });
    
    let responseText = "";
    if (Array.isArray(output)) {
      responseText = output[0]?.generated_text || "";
    } else if (typeof output === "object" && output !== null) {
      responseText = (output as any).generated_text || "";
    }
    
    logger.info("Generated text with transformerjs");
    
    // Try to parse as JSON if schema was provided
    if (schema && responseText) {
      try {
        // Try to extract JSON from markdown code blocks if present
        const jsonMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[1]);
        }
        // Try direct parse
        return JSON.parse(responseText);
      } catch (e) {
        logger.warn("Failed to parse response as JSON, returning text", e);
        // Return a simple object with the text
        return { response: responseText };
      }
    }
    
    return { response: responseText };
  } catch (e) {
    logger.error("generateStructuredJsonWithTransformerjs failed", e);
    throw e;
  }
}

export async function describeImageWithTransformerjs(
  imageBase64: string,
  prompt?: string,
  overrideModel?: string,
  maxTokens?: number
): Promise<string> {
  try {
    const pipe = await getImageToTextPipeline(overrideModel);
    
    // Remove data URL prefix if present
    const base64Data = imageBase64.replace(/^data:image\/[a-z]+;base64,/, "");
    
    // Convert base64 to buffer
    const imageBuffer = Buffer.from(base64Data, "base64");
    
    const output = await pipe(imageBuffer, {
      max_new_tokens: maxTokens || 100,
    });
    
    let description = "";
    if (Array.isArray(output)) {
      description = output[0]?.generated_text || "";
    } else if (typeof output === "object" && output !== null) {
      description = (output as any).generated_text || "";
    }
    
    logger.info("Generated image description with transformerjs");
    
    // If a custom prompt was provided, prepend it to the response
    if (prompt && description) {
      return `${prompt}: ${description}`;
    }
    
    return description || "Unable to generate image description";
  } catch (e) {
    logger.error("describeImageWithTransformerjs failed", e);
    throw e;
  }
}
