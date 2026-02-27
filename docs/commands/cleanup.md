# Cleanup Command

[Home](../../README.md) | [Docs Index](../README.md)

## Table of Contents

- [Usage](#usage)
- [Behavior](#behavior)
- [Safety Rules](#safety-rules)
- [Related Pages](#related-pages)

## Usage

```bash
git-ai cleanup
```

## Behavior

1. Fetches from origin
2. Finds local branches merged into `origin/main` or `origin/master`
3. Shows deletion candidates
4. Removes non-main worktrees for those branches
5. Confirms before deletion

## Safety Rules

- Never deletes current branch
- Never deletes protected branches (`main`, `master`, `develop`, `staging`)
- Deletes local branches only

## Related Pages

- [Worktree](./worktree.md)
- [Daily Flow](../workflows/daily-flow.md)

[Back to Docs Index](../README.md)
