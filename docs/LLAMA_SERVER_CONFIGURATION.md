# llama_server Provider Configuration Example

This example shows how to configure the llama_server provider to connect to llama.cpp's llama_server REST service.

## Basic Configuration

Add the following to your `config.json`:

```json
{
  "llmProvider": "llama-server",
  "llamaServer": {
    "llamaServerEndpoint": "http://localhost:8080",
    "llamaServerModel": "gpt-3.5-turbo",
    "llamaServerEmbedModel": "text-embedding-3-small",
    "llamaServerVisionModel": "gpt-4o-mini"
  }
}
```

## Configuration Options

| Option | Type | Description | Default |
|--------|------|-------------|---------|
| `llamaServerEndpoint` | string | Base URL of your llama_server instance | Required |
| `llamaServerApiKey` | string | Optional API key if authentication is required | Optional |
| `llamaServerModel` | string | Model name for chat/completion tasks | `gpt-3.5-turbo` |
| `llamaServerEmbedModel` | string | Model name for embedding tasks | `text-embedding-3-small` |
| `llamaServerVisionModel` | string | Model name for vision/multimodal tasks | `gpt-4o-mini` |
| `llamaServerTimeoutMs` | number | Request timeout in milliseconds | `60000` |

## Starting llama_server

llama_server is part of the llama.cpp project. To start it:

```bash
# Basic usage
./llama-server -m /path/to/your/model.gguf --port 8080

# With embeddings support
./llama-server -m /path/to/your/model.gguf --port 8080 --embedding

# With vision support (multimodal models)
./llama-server -m /path/to/your/vision-model.gguf --port 8080 --mmproj /path/to/mmproj.gguf
```

## Model Names

The model names in the configuration (e.g., `gpt-3.5-turbo`) are symbolic and passed to llama_server. llama_server uses the model you loaded when starting the server, regardless of the name in the request. These names are mainly for:
- UI display purposes
- Routing different task types to different llama_server instances
- Compatibility with OpenAI-style API calls

## Multiple llama_server Instances

If you want to use different models for different tasks, you can run multiple llama_server instances on different ports:

```json
{
  "llmProvider": "llama-server",
  "llamaServer": {
    "llamaServerEndpoint": "http://localhost:8080",
    "llamaServerModel": "llama-3-8b",
    "llamaServerEmbedModel": "text-embedding-3-small",
    "llamaServerVisionModel": "llava-v1.5-7b"
  }
}
```

Then start separate instances:
```bash
# Chat model on port 8080
./llama-server -m llama-3-8b.gguf --port 8080

# Embedding model on port 8081 (configure a second provider if needed)
./llama-server -m bge-m3.gguf --port 8081 --embedding

# Vision model on port 8082
./llama-server -m llava-v1.5-7b.gguf --port 8082 --mmproj llava-v1.5-mmproj.gguf
```

## Authentication

If your llama_server instance requires authentication, provide an API key:

```json
{
  "llmProvider": "llama-server",
  "llamaServer": {
    "llamaServerEndpoint": "http://localhost:8080",
    "llamaServerApiKey": "your-api-key-here",
    "llamaServerModel": "gpt-3.5-turbo"
  }
}
```

## Troubleshooting

### Connection Errors

If you get connection errors, verify:
1. llama_server is running: `curl http://localhost:8080/health`
2. The endpoint URL is correct (no trailing slash)
3. Port is accessible and not blocked by firewall

### Model Not Found

llama_server returns errors if:
- Model file is not found or cannot be loaded
- Embedding is requested but server wasn't started with `--embedding`
- Vision is requested but server wasn't started with `--mmproj`

Check llama_server logs for details.

## See Also

- [llama.cpp Documentation](https://github.com/ggerganov/llama.cpp)
- [llama_server API Reference](https://github.com/ggerganov/llama.cpp/tree/master/examples/server)
- [LLM Provider Architecture](./LLM_PROVIDER_ARCHITECTURE.md)
