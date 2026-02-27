# GitHub Token Configuration

[Home](../../README.md) | [Docs Index](../README.md)

## Table of Contents

- [When It Is Needed](#when-it-is-needed)
- [How to Configure](#how-to-configure)
- [Scopes](#scopes)
- [Related Pages](#related-pages)

## When It Is Needed

GitHub token is required for:

- Creating PRs directly from the CLI
- Publishing GitHub releases
- Fetching richer PR context for releases

## How to Configure

- Use `git-ai settings`
- Or set `GITHUB_TOKEN`
- Or store in config (local machine use only)

## Scopes

- `repo` for private repos
- `public_repo` for public repos

## Related Pages

- [PR Command](../commands/pr.md)
- [Release Command](../commands/release.md)
- [Configuration Overview](./overview.md)

[Back to Docs Index](../README.md)
