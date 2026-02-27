# Git AI CLI

[![CI](https://github.com/mr-mrs-panda/git-ai-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/mr-mrs-panda/git-ai-cli/actions/workflows/ci.yml)
[![Release](https://github.com/mr-mrs-panda/git-ai-cli/actions/workflows/release.yml/badge.svg)](https://github.com/mr-mrs-panda/git-ai-cli/actions/workflows/release.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

AI-powered Git workflow assistant built with Bun.

[demo.webm](https://github.com/user-attachments/assets/84d26b0c-3c78-45eb-8e0e-5fef7b0b7a44)

## AI Generation Notice

Large parts of this repository were generated with AI assistance, primarily using Claude Code, GitHub Copilot, and Codex.

I am aware that AI-generated code can be risky or incorrect in subtle ways. I have done my best to review every single line of code in this repository before shipping changes.

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

- [Docs Home](./docs/README.md)
- [Getting Started](./docs/getting-started/installation.md)
- [Command Reference](./docs/commands/overview.md)
- [Workflows](./docs/workflows/daily-flow.md)
- [Configuration](./docs/configuration/overview.md)
- [Troubleshooting](./docs/troubleshooting/common-issues.md)
- [Development](./docs/development/local-dev.md)

## Common Commands

| Command | What it does | Docs |
| --- | --- | --- |
| `git-ai auto` | Runs the full flow: branch, commit, push, and PR. | [Auto](./docs/commands/auto.md) |
| `git-ai prepare` | Prepares a clean base branch and handles local changes safely. | [Prepare](./docs/commands/prepare.md) |
| `git-ai branch` | Suggests and creates a branch name from your current changes. | [Branch](./docs/commands/branch.md) |
| `git-ai stage` | Interactively stages and unstages files in one view. | [Stage](./docs/commands/stage.md) |
| `git-ai commit` | Generates commit message(s) from your diff and commits. | [Commit](./docs/commands/commit.md) |
| `git-ai pr` | Generates PR title/description and can open a PR. | [PR](./docs/commands/pr.md) |
| `git-ai release` | Creates a version tag and release notes, then publishes release. | [Release](./docs/commands/release.md) |
| `git-ai cleanup` | Removes local branches/worktrees already merged into base. | [Cleanup](./docs/commands/cleanup.md) |
| `git-ai worktree <name>` | Creates a sibling worktree and branch from `main`. | [Worktree](./docs/commands/worktree.md) |
| `git-ai settings` | Configures provider, model, tokens, and defaults. | [First Run and Setup](./docs/getting-started/first-run.md) |
| `git-ai unwrapped` | Builds a Year in Code HTML report. | [Reports](./docs/commands/reports.md) |
| `git-ai celebrate` | Builds a visual PR celebration page. | [Reports](./docs/commands/reports.md) |

More command syntax and options: [Commands Overview](./docs/commands/overview.md)

## Cross Links

- Want a recommended daily path? [Daily Workflow](./docs/workflows/daily-flow.md)
- Shipping hotfixes fast? [Release Workflow](./docs/workflows/release-flow.md)
- Setting up model/provider details? [LLM Profiles](./docs/configuration/llm-profiles.md)
- Configuring GitHub access? [GitHub Token](./docs/configuration/github-token.md)
- Running into issues? [Common Issues](./docs/troubleshooting/common-issues.md)

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
