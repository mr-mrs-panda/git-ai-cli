# Release Command

[Home](../../README.md) | [Docs Index](../README.md)

## Table of Contents

- [Usage](#usage)
- [Behavior](#behavior)
- [PR Integration](#pr-integration)
- [Related Pages](#related-pages)

## Usage

```bash
git-ai release
git-ai release --no-prs
git-ai release -y
```

## Behavior

1. Switches to `main`/`master`
2. Pulls latest changes
3. Analyzes commits since last tag/release
4. Optionally fetches merged PR context
5. Suggests semantic bump and release notes
6. Creates tag and publishes GitHub release when token is available

## PR Integration

Enabled by default and can be disabled with `--no-prs`.

## Related Pages

- [PR](./pr.md)
- [Release Flow](../workflows/release-flow.md)
- [GitHub Token](../configuration/github-token.md)

[Back to Docs Index](../README.md)
