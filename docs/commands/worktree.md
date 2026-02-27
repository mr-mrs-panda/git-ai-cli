# Worktree Command

[Home](../../README.md) | [Docs Index](../README.md)

## Table of Contents

- [Usage](#usage)
- [Behavior](#behavior)
- [Naming Rules](#naming-rules)
- [Related Pages](#related-pages)

## Usage

```bash
git-ai worktree <branch-name>
```

Example:

```bash
git-ai worktree social-media-master
```

## Behavior

1. Validates branch/worktree name
2. Aborts if non-main branch has uncommitted changes
3. Ensures `main` is clean
4. Creates sibling worktree folder `../<project>-<sanitized-name>`
5. Creates new branch from `main`

## Naming Rules

Folder names are sanitized to:

- `a-z`
- `0-9`
- `.` `_` `-`

## Related Pages

- [Cleanup](./cleanup.md)
- [Prepare](./prepare.md)

[Back to Docs Index](../README.md)
