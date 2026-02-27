# Auto Command

[Home](../../README.md) | [Docs Index](../README.md)

## Table of Contents

- [Usage](#usage)
- [Behavior](#behavior)
- [Blind Mode](#blind-mode)
- [YOLO Mode](#yolo-mode)
- [Release Mode](#release-mode)
- [Related Pages](#related-pages)

## Usage

```bash
git-ai auto
git-ai auto -y
git-ai auto --yolo
git-ai auto --release
```

## Behavior

`auto` is the end-to-end workflow:

1. Creates branch when starting from `main`/`master`
2. Stages and commits based on commit preferences
3. Pushes branch to origin
4. Creates GitHub PR (draft behavior from settings)

## Blind Mode

Use `-y` or `--yes` to auto-accept prompts.

## YOLO Mode

Use `--yolo` to auto-merge the created PR and delete the feature branch.

## Release Mode

Use `--release` to include release creation after PR merge.

## Related Pages

- [Prepare](./prepare.md)
- [Commit](./commit.md)
- [PR](./pr.md)
- [Release](./release.md)
- [Daily Flow](../workflows/daily-flow.md)

[Back to Docs Index](../README.md)
