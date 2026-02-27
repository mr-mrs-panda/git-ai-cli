# Prepare Command

[Home](../../README.md) | [Docs Index](../README.md)

## Table of Contents

- [Usage](#usage)
- [Behavior](#behavior)
- [Change Handling Options](#change-handling-options)
- [Related Pages](#related-pages)

## Usage

```bash
git-ai prepare
git-ai prepare -y
```

## Behavior

`prepare` gets your repo ready for a fresh feature start:

1. Detects whether you are on a feature branch or base branch
2. Handles uncommitted changes
3. Moves to `main`/`master`
4. Pulls latest from remote
5. Reapplies stashed changes when stash option was chosen

## Change Handling Options

- Commit: stage all changes and create AI-generated commit
- Stash: stash temporary changes and reapply later
- Discard: reset to `HEAD` (destructive)
- Abort: cancel operation

## Related Pages

- [Auto](./auto.md)
- [Branch](./branch.md)
- [Daily Flow](../workflows/daily-flow.md)
- [Common Issues](../troubleshooting/common-issues.md)

[Back to Docs Index](../README.md)
