# First Run and Setup

[Home](../../README.md) | [Docs Index](../README.md)

## Table of Contents

- [Initial Launch](#initial-launch)
- [Settings Command](#settings-command)
- [What Gets Saved](#what-gets-saved)
- [Related Pages](#related-pages)

## Initial Launch

Run:

```bash
git-ai
```

On first run, the setup flow guides you through:

- Provider selection
- API key handling (or local/no-key options)
- Live model discovery where supported
- Default model selection

## Settings Command

Reconfigure at any time:

```bash
git-ai settings
```

Use settings to update:

- LLM provider/model/temperature/reasoning effort
- Commit behavior defaults
- PR draft defaults
- GitHub token

## What Gets Saved

Configuration is stored at:

- `~/.config/git-ai/config.json`

Prefer environment variables for keys in team or CI environments.

## Related Pages

- [Configuration Overview](../configuration/overview.md)
- [LLM Profiles](../configuration/llm-profiles.md)
- [GitHub Token](../configuration/github-token.md)

[Back to Docs Index](../README.md)
