# LLM Provider Health Check 使用说明

## 概述

每个 LLM 提供商现在都包含一个服务健康检查方法 `checkServiceHealth()`，该方法通过调用提供商的模型列表接口来判断服务是否正常工作。

## 使用方法

### 1. 检查单个提供商健康状态

```typescript
import { openAIProvider } from './client/electron/backend/utils/OpenAIProvider';
import { ollamaProvider } from './client/electron/backend/utils/OllamaProvider';
import { openRouterProvider } from './client/electron/backend/utils/OpenRouterProvider';
import { llamaCppProvider } from './client/electron/backend/utils/LlamaCppProvider';
import { bailianProvider } from './client/electron/backend/utils/BailianProvider';

// 检查 OpenAI 服务
const isOpenAIHealthy = await openAIProvider.checkServiceHealth();
console.log(`OpenAI service is ${isOpenAIHealthy ? 'healthy' : 'unhealthy'}`);

// 检查 Ollama 服务
const isOllamaHealthy = await ollamaProvider.checkServiceHealth();
console.log(`Ollama service is ${isOllamaHealthy ? 'healthy' : 'unhealthy'}`);

// 检查 OpenRouter 服务
const isOpenRouterHealthy = await openRouterProvider.checkServiceHealth();
console.log(`OpenRouter service is ${isOpenRouterHealthy ? 'healthy' : 'unhealthy'}`);

// 检查 LlamaCpp 服务
const isLlamaCppHealthy = await llamaCppProvider.checkServiceHealth();
console.log(`LlamaCpp service is ${isLlamaCppHealthy ? 'healthy' : 'unhealthy'}`);

// 检查 Bailian 服务
const isBailianHealthy = await bailianProvider.checkServiceHealth();
console.log(`Bailian service is ${isBailianHealthy ? 'healthy' : 'unhealthy'}`);
```

### 2. 使用 LLMProviderFactory 检查健康状态

```typescript
import { providerFactory } from './client/electron/backend/utils/LLMProviderFactory';

// 检查特定提供商
const isHealthy = await providerFactory.checkProviderHealth('openai');
console.log(`Provider is ${isHealthy ? 'healthy' : 'unhealthy'}`);

// 检查所有已注册的提供商
const healthStatus = await providerFactory.checkAllProvidersHealth();
healthStatus.forEach((isHealthy, providerType) => {
  console.log(`${providerType}: ${isHealthy ? '✓ healthy' : '✗ unhealthy'}`);
});
```

### 3. 在 Express API 中使用

```typescript
import express from 'express';
import { providerFactory } from './client/electron/backend/utils/LLMProviderFactory';

const app = express();

// 检查特定提供商健康状态
app.post('/api/providers/health', async (req, res) => {
  try {
    const { provider } = req.body;
    
    if (provider) {
      // 检查单个提供商
      const isHealthy = await providerFactory.checkProviderHealth(provider);
      res.json({
        success: true,
        data: {
          provider,
          healthy: isHealthy
        }
      });
    } else {
      // 检查所有提供商
      const healthStatus = await providerFactory.checkAllProvidersHealth();
      const result: Record<string, boolean> = {};
      healthStatus.forEach((isHealthy, providerType) => {
        result[providerType] = isHealthy;
      });
      
      res.json({
        success: true,
        data: result
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'HEALTH_CHECK_FAILED',
        message: error.message
      }
    });
  }
});
```

## 各提供商健康检查实现细节

### OpenAI
- 使用 OpenAI SDK 的 `client.models.list()` 方法
- 如果能成功获取模型列表，则认为服务健康

### OpenRouter
- 使用 GET 请求调用 `/models` 端点
- 如果能成功获取模型列表，则认为服务健康

### Ollama
- 使用 GET 请求调用 `/api/tags` 端点
- 如果能成功获取模型列表，则认为服务健康

### LlamaCpp
- 使用 GET 请求调用 `/health` 端点
- 如果健康检查端点返回成功状态，则认为服务健康

### Bailian
- 使用 GET 请求调用 `/models` 端点（OpenAI 兼容接口）
- 如果能成功获取模型列表，则认为服务健康

## 错误处理

所有健康检查方法都会捕获异常并返回 `false`，而不是抛出错误。这样可以安全地调用健康检查而不用担心程序崩溃。

```typescript
// 安全调用，不会抛出异常
const isHealthy = await provider.checkServiceHealth();
if (!isHealthy) {
  console.warn('Provider is not available, falling back to alternative');
  // 实现降级逻辑
}
```

## 超时设置

健康检查使用较短的超时时间（通常为 5 秒），以避免长时间等待不可用的服务。

## 使用场景

1. **系统启动时检查**: 在应用启动时检查所有配置的提供商是否可用
2. **定期健康检查**: 定时检查服务状态，实现服务监控
3. **故障转移**: 当主要提供商不可用时，自动切换到备用提供商
4. **用户界面提示**: 在 UI 中显示各提供商的可用状态
5. **配置验证**: 在保存配置后立即验证服务是否可达
