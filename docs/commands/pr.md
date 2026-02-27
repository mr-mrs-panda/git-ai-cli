# PR Command

[Home](../../README.md) | [Docs Index](../README.md)

## Table of Contents

- [Usage](#usage)
- [Behavior](#behavior)
- [GitHub Token](#github-token)
- [Related Pages](#related-pages)

## Usage

```bash
git-ai pr
```

## Behavior

Generates PR title and description based on:

- Branch name
- Commit messages
- Branch comparison with base branch

Can create GitHub PR directly when token is configured.

## GitHub Token

Configure via `git-ai settings` or `GITHUB_TOKEN` environment variable.

## Related Pages

- [Auto](./auto.md)
- [Release](./release.md)
- [GitHub Token](../configuration/github-token.md)

[Back to Docs Index](../README.md)
