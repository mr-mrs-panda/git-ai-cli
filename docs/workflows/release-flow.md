# Release Workflow

[Home](../../README.md) | [Docs Index](../README.md)

## Table of Contents

- [Standard Release Path](#standard-release-path)
- [Fast Path via Auto](#fast-path-via-auto)
- [Related Pages](#related-pages)

## Standard Release Path

1. Ensure target PRs are merged
2. Run `git-ai release`
3. Confirm semantic bump proposal
4. Review generated release notes
5. Publish release

## Fast Path via Auto

For small hotfixes:

1. Make change
2. Run `git-ai auto --release`
3. Optionally combine with `-y` for full auto-accept

## Related Pages

- [Release](../commands/release.md)
- [Auto](../commands/auto.md)
- [GitHub Token](../configuration/github-token.md)

[Back to Docs Index](../README.md)
