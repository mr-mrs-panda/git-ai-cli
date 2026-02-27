# Common Issues

[Home](../../README.md) | [Docs Index](../README.md)

## Table of Contents

- [No Models Found](#no-models-found)
- [GitHub Actions Failures](#github-actions-failures)
- [Token Not Detected](#token-not-detected)
- [Command Cannot Run](#command-cannot-run)
- [Related Pages](#related-pages)

## No Models Found

- Verify provider API key/env var
- Verify network connectivity
- Retry via `git-ai settings` model discovery
- Use manual model ID when discovery is unavailable

## GitHub Actions Failures

- Confirm branch is pushed
- Confirm token has required scopes
- Check repository permissions for PR/release actions

## Token Not Detected

- Verify `GITHUB_TOKEN` in shell environment
- Verify `githubToken` in config
- Re-run `git-ai settings`

## Command Cannot Run

- Confirm running inside a Git repository
- Confirm Bun version is `>=1.3.4`
- Confirm current branch/worktree meets command preconditions

## Related Pages

- [Installation](../getting-started/installation.md)
- [LLM Profiles](../configuration/llm-profiles.md)
- [GitHub Token](../configuration/github-token.md)

[Back to Docs Index](../README.md)
