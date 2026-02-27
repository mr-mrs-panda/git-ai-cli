# Commit Command

[Home](../../README.md) | [Docs Index](../README.md)

## Table of Contents

- [Usage](#usage)
- [Modes](#modes)
- [Behavior](#behavior)
- [File Limits](#file-limits)
- [Related Pages](#related-pages)

## Usage

```bash
git-ai commit
git-ai commit --single
git-ai commit --grouped
```

## Modes

- `grouped`: plan groups then generate per-group commit messages
- `single`: generate one commit message for all included changes

## Behavior

By default, commit stages all changes first (`preferences.commit.alwaysStageAll: true`).

If disabled, already staged files are preferred when available.

## File Limits

AI analysis skips:

- Files larger than 100KB
- Migration files (pattern-based)
- Deleted files

## Related Pages

- [Stage](./stage.md)
- [Configuration Overview](../configuration/overview.md)
- [LLM Profiles](../configuration/llm-profiles.md)

[Back to Docs Index](../README.md)
