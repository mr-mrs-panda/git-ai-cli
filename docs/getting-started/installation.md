# Installation

[Home](../../README.md) | [Docs Index](../README.md)

## Table of Contents

- [Quick Install](#quick-install)
- [Manual Install](#manual-install)
- [Requirements](#requirements)
- [Related Pages](#related-pages)

## Quick Install

Use the installer script from the repository root:

```bash
./install.sh
```

The installer will:

- Build the application
- Install to `~/.local/bin/git-ai`
- Add `~/.local/bin` to PATH when needed

After install, restart your shell or source your shell config:

```bash
source ~/.bashrc
source ~/.zshrc
source ~/.config/fish/config.fish
```

## Manual Install

If you prefer manual setup:

```bash
bun install
bun run src/cli.ts
```

For a standalone binary build:

```bash
bun run build
```

## Requirements

- Bun `>=1.3.4`
- A Git repository
- Provider access for LLM features (OpenAI, Gemini, Anthropic, Ollama, or compatible endpoint)

## Related Pages

- [First Run and Setup](./first-run.md)
- [Configuration Overview](../configuration/overview.md)
- [Common Issues](../troubleshooting/common-issues.md)

[Back to Docs Index](../README.md)
