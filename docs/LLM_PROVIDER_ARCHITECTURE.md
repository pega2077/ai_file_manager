# LLM Provider Architecture

## Overview

The LLM provider system has been refactored to use an object-oriented architecture, providing a unified interface for integrating multiple AI service providers. This design improves maintainability, extensibility, and code reusability.

## Architecture Diagram

```
┌─────────────────────────────────────────┐
│         BaseLLMProvider                 │
│  (Abstract Base Class)                  │
│                                         │
│  + embed(inputs, model?)                │
│  + generateStructuredJson(params)       │
│  + describeImage(images, options?)      │
│                                         │
│  # resolveConfig(cfg): Config           │
│  # getDefaultEmbedModel(): string       │
│  # getDefaultChatModel(): string        │
│  # getDefaultVisionModel(): string      │
│  # normalizeJsonSchema(input)           │
│  # tryParseJson(raw)                    │
│  # buildHeaders(config)                 │
│  # handleHttpError(...)                 │
└─────────────────────────────────────────┘
              ▲
              │
    ┌─────────┼─────────┐
    │         │         │
┌───┴───┐ ┌───┴───┐ ┌───┴───────┐
│OpenAI │ │OpenRouter│OllamaProvider│
│Provider│ │Provider│             │
└───────┘ └───────┘ └─────────────┘
                          ▲
                          │
                    ┌─────┴──────┐
                    │PegaOllama  │
                    │   Client   │
                    └────────────┘
```

## Core Components

### 1. BaseLLMProvider (Abstract Base Class)

**Location**: `client/electron/backend/utils/BaseLLMProvider.ts`

**Purpose**: Provides common functionality and enforces a consistent interface across all provider implementations.

**Abstract Members**:
- `providerLabel: string` - Provider name for logging
- `resolveConfig(cfg: AppConfig): ProviderResolvedConfig` - Parse configuration
- `getDefaultEmbedModel(): string` - Default embedding model
- `getDefaultChatModel(): string` - Default chat model
- `getDefaultVisionModel(): string` - Default vision model

**Public Methods**:
- `embed(inputs: string[], overrideModel?: string): Promise<number[][]>` - Generate text embeddings
- `generateStructuredJson(params: GenerateStructuredJsonParams): Promise<unknown>` - Generate structured JSON
- `describeImage(images: string[], options?: DescribeImageOptions): Promise<string>` - Describe images

**Protected Utilities**:
- `normalizeJsonSchema<T>(input: T): T` - Ensure JSON schema compatibility
- `tryParseJson(raw: string)` - Extract JSON from text
- `buildHeaders(config)` - Build HTTP headers
- `handleHttpError(...)` - Unified error handling
- `validateInputs(...)` - Input validation

### 2. Provider Implementations

#### OpenAIProvider

**Location**: `client/electron/backend/utils/OpenAIProvider.ts`

**Features**:
- Uses official OpenAI SDK
- Supports custom endpoints (Azure OpenAI compatible)
- Configuration from `config.openai` or environment variables
- Default models: `text-embedding-3-large`, `gpt-4o-mini`

**Configuration**:
```json
{
  "openai": {
    "openaiApiKey": "sk-...",
    "openaiEndpoint": "https://api.openai.com/v1",
    "openaiModel": "gpt-4o-mini",
    "openaiEmbedModel": "text-embedding-3-large",
    "openaiVisionModel": "gpt-4o-mini"
  }
}
```

**Environment Variables**:
- `OPENAI_API_KEY` - API key fallback

#### OpenRouterProvider

**Location**: `client/electron/backend/utils/OpenRouterProvider.ts`

**Features**:
- OpenAI-compatible API with custom headers
- Automatic JSON schema normalization
- Configurable timeout and custom headers
- Default models: `openrouter/auto`, `qwen/qwen3-embedding-0.6b`

**Configuration**:
```json
{
  "openrouter": {
    "openrouterApiKey": "sk-or-...",
    "openrouterEndpoint": "https://openrouter.ai/api/v1",
    "openrouterModel": "openrouter/auto",
    "openrouterEmbedModel": "qwen/qwen3-embedding-0.6b",
    "openrouterVisionModel": "gpt-4o-mini",
    "openrouterTimeoutMs": 60000,
    "openrouterReferer": "https://github.com/pega2077/ai_file_manager",
    "openrouterTitle": "AI File Manager",
    "openrouterHeaders": {
      "Custom-Header": "value"
    }
  }
}
```

**Environment Variables**:
- `OPENROUTER_API_KEY` - API key fallback

#### OllamaProvider

**Location**: `client/electron/backend/utils/OllamaProvider.ts`

**Features**:
- Local model support via Ollama API
- Message to prompt conversion
- JSON schema instruction generation
- Default models: `bge-m3`, `qwen3:8b`

**Configuration**:
```json
{
  "ollama": {
    "ollamaEndpoint": "http://localhost:11434",
    "ollamaModel": "qwen3:8b",
    "ollamaEmbedModel": "bge-m3",
    "ollamaVisionModel": "qwen3:8b",
    "ollamaApiKey": ""
  }
}
```

### 3. Shared Types

**Location**: `client/electron/backend/utils/llmProviderTypes.ts`

```typescript
// Unified configuration structure
interface ProviderResolvedConfig {
  endpoint?: string;
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  chatModel?: string;
  embedModel?: string;
  visionModel?: string;
  headers?: Record<string, string>;
}

// Structured JSON generation parameters
interface GenerateStructuredJsonParams {
  messages: ChatCompletionMessageParam[];
  responseFormat?: {
    json_schema?: {
      name?: string;
      schema: Record<string, unknown>;
      strict?: boolean;
    };
  };
  temperature?: number;
  maxTokens?: number;
  overrideModel?: string;
  language?: SupportedLang;
}

// Image description options
interface DescribeImageOptions {
  prompt?: string;
  overrideModel?: string;
  timeoutMs?: number;
  maxTokens?: number;
}
```

### 4. Provider Factory

**Location**: `client/electron/backend/utils/LLMProviderFactory.ts`

**Purpose**: Centralized provider instantiation and registration.

```typescript
import { providerFactory } from './LLMProviderFactory';

// Get provider instance
const provider = providerFactory.getProvider('openai');

// Use provider
const embeddings = await provider.embed(['Hello world']);
```

**Supported Types**:
- `'openai'` - OpenAI/Azure OpenAI
- `'azure-openai'` - Alias for OpenAI (uses same provider)
- `'openrouter'` - OpenRouter
- `'ollama'` - Ollama
- `'bailian'` - Bailian (future)
- `'pega'` - Pega (future)

## Usage Examples

### Using Providers Directly

```typescript
import { openAIProvider } from './OpenAIProvider';
import { openRouterProvider } from './OpenRouterProvider';
import { ollamaProvider } from './OllamaProvider';

// Embedding
const embeddings = await openAIProvider.embed(['text1', 'text2']);

// Structured JSON
const result = await openRouterProvider.generateStructuredJson({
  messages: [{ role: 'user', content: 'Generate a summary' }],
  responseFormat: {
    json_schema: {
      name: 'summary',
      schema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          content: { type: 'string' }
        },
        required: ['title', 'content']
      }
    }
  },
  temperature: 0.7,
  maxTokens: 1500
});

// Image description
const description = await ollamaProvider.describeImage(
  [base64Image],
  { prompt: 'What is in this image?', maxTokens: 500 }
);
```

### Using the Factory

```typescript
import { providerFactory } from './LLMProviderFactory';

const provider = providerFactory.getProvider('openai');
const result = await provider.embed(['Hello', 'World']);
```

### Backward Compatibility

All legacy function exports are maintained:

```typescript
// Old API (still works)
import { embedWithOpenAI } from './openai';
import { generateStructuredJsonWithOpenRouter } from './openrouter';
import { ollamaClient } from './ollama';

// These functions are now wrappers around provider instances
const embeddings = await embedWithOpenAI(['text']);
const json = await generateStructuredJsonWithOpenRouter(messages, schema);
const result = await ollamaClient.generateStructuredJson(
  messages, format, temp, tokens, model, lang
);
```

## Extending with New Providers

To add a new provider:

1. **Create Provider Class**

```typescript
import { BaseLLMProvider } from './BaseLLMProvider';
import type { ProviderResolvedConfig, GenerateStructuredJsonParams, DescribeImageOptions } from './llmProviderTypes';

export class MyCustomProvider extends BaseLLMProvider {
  protected readonly providerLabel = 'MyCustom';

  protected resolveConfig(cfg: AppConfig): ProviderResolvedConfig {
    return {
      apiKey: cfg.myCustom?.apiKey,
      endpoint: cfg.myCustom?.endpoint,
      // ... other config
    };
  }

  protected getDefaultEmbedModel(): string {
    return 'my-embed-model';
  }

  protected getDefaultChatModel(): string {
    return 'my-chat-model';
  }

  protected getDefaultVisionModel(): string {
    return 'my-vision-model';
  }

  public async embed(inputs: string[], overrideModel?: string): Promise<number[][]> {
    // Implementation
  }

  public async generateStructuredJson(params: GenerateStructuredJsonParams): Promise<unknown> {
    // Implementation
  }

  public async describeImage(images: string[], options?: DescribeImageOptions): Promise<string> {
    // Implementation
  }
}
```

2. **Register with Factory**

```typescript
import { providerFactory } from './LLMProviderFactory';
import { myCustomProvider } from './MyCustomProvider';

providerFactory.register('mycustom', myCustomProvider);
```

3. **Update Configuration Types**

Add configuration section to `AppConfig` in `configManager.ts`:

```typescript
export interface AppConfig {
  // ...
  myCustom?: {
    apiKey?: string;
    endpoint?: string;
    model?: string;
    embedModel?: string;
    visionModel?: string;
  };
  llmProvider?: 'ollama' | 'openai' | 'openrouter' | 'mycustom' | ...;
}
```

## Error Handling

All providers follow consistent error handling:

1. **Configuration Errors**: Thrown immediately if API key or endpoint is missing
2. **Network Errors**: Logged with context and re-thrown
3. **Response Errors**: Parsed and logged with status codes and messages
4. **Timeout Handling**: Configurable timeouts with AbortController

Example error log:
```
ERROR: OpenRouter request failed {
  url: 'https://openrouter.ai/api/v1/chat/completions',
  status: 401,
  message: 'Invalid API key',
  providerErrorCode: 'auth_error'
}
```

## Configuration Precedence

For each provider, configuration values are resolved in this order:

1. Provider-specific config section (e.g., `config.openai.openaiModel`)
2. Global fallback fields (e.g., `config.openaiModel`)
3. Environment variables (e.g., `OPENAI_API_KEY`)
4. Default values

## Logging

All providers use the unified logger with consistent message format:

- Info: Model selection, configuration, request initiation
- Warn: Non-critical issues (e.g., embedding count mismatch)
- Error: Failed requests, parsing errors, configuration issues

Sensitive data (API keys) is never logged.

## Benefits

1. **Maintainability**: Common logic in base class, provider-specific logic isolated
2. **Extensibility**: Easy to add new providers by extending BaseLLMProvider
3. **Testability**: Each provider can be tested independently
4. **Type Safety**: Unified interfaces with TypeScript type checking
5. **Backward Compatibility**: Existing code continues to work without changes
6. **Configuration**: Consistent configuration patterns across providers
7. **Error Handling**: Unified error handling and logging
