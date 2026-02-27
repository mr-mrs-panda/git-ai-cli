# Git AI CLI

[![CI](https://github.com/mr-mrs-panda/git-ai-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/mr-mrs-panda/git-ai-cli/actions/workflows/ci.yml)
[![Release](https://github.com/mr-mrs-panda/git-ai-cli/actions/workflows/release.yml/badge.svg)](https://github.com/mr-mrs-panda/git-ai-cli/actions/workflows/release.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

AI-powered Git workflow assistant built with Bun.

[demo.webm](https://github.com/user-attachments/assets/84d26b0c-3c78-45eb-8e0e-5fef7b0b7a44)

## Quick Start

Install:

```bash
./install.sh
```

Run:

```bash
git-ai
```

## Documentation

- [Documentation Index](./docs/README.md)
- [Getting Started: Installation](./docs/getting-started/installation.md)
- [Getting Started: First Run](./docs/getting-started/first-run.md)
- [Commands Overview](./docs/commands/overview.md)
- [Daily Workflow](./docs/workflows/daily-flow.md)
- [Release Workflow](./docs/workflows/release-flow.md)
- [Configuration Overview](./docs/configuration/overview.md)
- [Troubleshooting](./docs/troubleshooting/common-issues.md)
- [Development](./docs/development/local-dev.md)

## Common Commands

### Command Quick Reference

- `git-ai auto`: End-to-end automation (branch -> commit -> push -> PR).  
  Docs: [Auto](./docs/commands/auto.md) | [Daily Workflow](./docs/workflows/daily-flow.md) | [Release Flow](./docs/workflows/release-flow.md)
- `git-ai prepare`: Räumt den Arbeitsstand auf und bringt dich sauber auf `main`/`master`.  
  Docs: [Prepare](./docs/commands/prepare.md) | [Daily Workflow](./docs/workflows/daily-flow.md)
- `git-ai branch`: Erstellt einen AI-vorgeschlagenen Branch-Namen aus deinen Änderungen.  
  Docs: [Branch](./docs/commands/branch.md) | [Daily Workflow](./docs/workflows/daily-flow.md)
- `git-ai stage`: Interaktives Stage/Unstage in einem Schritt.  
  Docs: [Stage](./docs/commands/stage.md) | [Commit](./docs/commands/commit.md)
- `git-ai commit`: Generiert Commit-Message(s) aus deinen Änderungen und committet.  
  Docs: [Commit](./docs/commands/commit.md) | [LLM Profiles](./docs/configuration/llm-profiles.md)
- `git-ai pr`: Erzeugt PR-Titel/-Beschreibung und kann PR direkt anlegen.  
  Docs: [PR](./docs/commands/pr.md) | [GitHub Token](./docs/configuration/github-token.md)
- `git-ai release`: Erstellt Tag + Release Notes und publiziert GitHub Release.  
  Docs: [Release](./docs/commands/release.md) | [Release Flow](./docs/workflows/release-flow.md) | [GitHub Token](./docs/configuration/github-token.md)
- `git-ai cleanup`: Löscht lokal gemergte Branches und räumt zugehörige Worktrees auf.  
  Docs: [Cleanup](./docs/commands/cleanup.md) | [Worktree](./docs/commands/worktree.md)
- `git-ai worktree <branch-name>`: Erstellt einen neuen Worktree + Branch aus `main`.  
  Docs: [Worktree](./docs/commands/worktree.md) | [Cleanup](./docs/commands/cleanup.md)
- `git-ai settings`: Konfiguriert Provider, Modell, Token und Defaults.  
  Docs: [First Run](./docs/getting-started/first-run.md) | [Configuration Overview](./docs/configuration/overview.md)
- `git-ai unwrapped`: Erstellt den Year-in-Code HTML Report.  
  Docs: [Reports](./docs/commands/reports.md)
- `git-ai celebrate`: Erstellt eine visuelle PR-Celebration-Page.  
  Docs: [Reports](./docs/commands/reports.md)

Full command list and syntax: [Commands Overview](./docs/commands/overview.md)

## Development

```bash
bun install
bun run dev
bun test
bun run typecheck
```

## Requirements

- Bun `>=1.3.4`
- Git repository
- Provider credentials for AI features

For full command, configuration, and workflow details, use the [docs index](./docs/README.md).
