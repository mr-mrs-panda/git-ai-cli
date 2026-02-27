# Configuration Overview

[Home](../../README.md) | [Docs Index](../README.md)

## Table of Contents

- [Config Location](#config-location)
- [Example Config](#example-config)
- [Preference Areas](#preference-areas)
- [Related Pages](#related-pages)

## Config Location

`~/.config/git-ai/config.json`

## Example Config

```json
{
  "githubToken": "ghp-your-github-token-here",
  "llm": {
    "defaultProfile": "smart-main",
    "profiles": {
      "smart-main": {
        "provider": "openai",
        "model": "provider-model-id",
        "temperature": 0.7,
        "reasoningEffort": "low",
        "baseUrl": "https://api.openai.com/v1",
        "apiKeyEnv": "OPENAI_API_KEY"
      }
    }
  },
  "preferences": {
    "commit": {
      "alwaysStageAll": true,
      "defaultMode": "grouped",
      "autoPushOnYes": false
    },
    "pullRequest": {
      "createAsDraft": true
    }
  }
}
```

## Preference Areas

- LLM provider/model/runtime behavior
- Commit defaults
- Pull request defaults
- GitHub token

## Related Pages

- [LLM Profiles](./llm-profiles.md)
- [GitHub Token](./github-token.md)
- [First Run and Setup](../getting-started/first-run.md)

[Back to Docs Index](../README.md)
