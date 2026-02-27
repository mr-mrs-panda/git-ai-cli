# LLM Profiles

[Home](../../README.md) | [Docs Index](../README.md)

## Table of Contents

- [Supported Providers](#supported-providers)
- [Key Fields](#key-fields)
- [Reasoning Levels](#reasoning-levels)
- [Related Pages](#related-pages)

## Supported Providers

- OpenAI
- Gemini
- Anthropic
- Ollama
- Custom OpenAI-compatible endpoints

## Key Fields

- `provider`
- `model`
- `temperature`
- `reasoningEffort`
- `baseUrl` (for custom/openai-compatible)
- `apiKeyEnv` and optional `apiKey`

Models are discovered dynamically where supported.

## Reasoning Levels

- `none`
- `low`
- `medium`
- `high`
- `xhigh`

## Related Pages

- [Configuration Overview](./overview.md)
- [Common Issues](../troubleshooting/common-issues.md)

[Back to Docs Index](../README.md)
