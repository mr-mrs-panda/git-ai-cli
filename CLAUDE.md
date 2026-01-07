# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Git AI CLI - Development Guide

## Project Overview

Git AI CLI is an AI-powered Git workflow tool built with Bun. It provides intelligent automation for:
- **Auto Mode**: End-to-end workflow (branch creation → commit → push → PR)
- **Branch Creation**: AI-generated branch names from changes
- **Commit Generation**: Conventional commit messages from diffs
- **PR Suggestions**: GitHub PR creation with AI-generated titles/descriptions

---

## Bun Runtime Guidelines

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

### Bun APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- **IMPORTANT:** Use `Bun.spawn()` for shell commands, NOT `Bun.$` template literals (see Critical Patterns below)

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

---

## Build & Development

### Commands

```bash
# Development mode with hot reload
bun run dev

# Build standalone executable
bun run build

# Install to ~/.local/bin
./install.sh

# Uninstall
./uninstall.sh
```

### Configuration

Config stored at `~/.config/git-ai/config.json`:
```json
{
  "openaiApiKey": "sk-...",
  "githubToken": "ghp_...",
  "model": "gpt-5.2",
  "temperature": 1,
  "reasoningEffort": "low"
}
```

**Token Fallback Chain:**
- GitHub: config.githubToken → process.env.GITHUB_TOKEN → prompt user
- OpenAI: config.openaiApiKey → prompt user

---

## Architecture

### Service-Oriented Design

```
Commands (user-facing)
    ↓
Services (business logic)
    ↓
Utils (git, OpenAI, config operations)
```

**Key Principles:**
1. Commands handle UI/UX and user interaction
2. Services contain reusable business logic
3. Utils provide low-level operations (git, API calls, config)
4. Services are composed and reused across commands

### Directory Structure

```
src/
├── commands/           # User-facing CLI commands
│   ├── auto.ts        # Auto mode workflow
│   ├── commit.ts      # Commit message generation
│   ├── create-branch.ts # Branch creation
│   ├── pr-suggest.ts  # PR title/description generation
│   ├── release.ts     # GitHub release creation
│   ├── cleanup.ts     # Delete merged branches
│   └── settings.ts    # Configuration management
├── services/          # Reusable business logic
│   ├── branch.ts      # Branch name analysis
│   ├── commit.ts      # Commit generation logic
│   └── release.ts     # Release notes generation and version bumping
└── utils/             # Low-level operations
    ├── config.ts      # Config file management
    ├── git.ts         # Git operations
    └── openai.ts      # OpenAI API interactions
```

---

## Critical Technical Patterns

### 1. Command Options Pattern - Auto-Yes Flag

All commands accept an `autoYes` option for automation and CI/CD usage:

```typescript
export interface CommandOptions {
  autoYes?: boolean;  // Skip confirmations, auto-accept prompts
}

export async function myCommand(options: CommandOptions = {}): Promise<void> {
  const { autoYes = false } = options;

  // For confirmation prompts
  if (!autoYes) {
    const response = await p.confirm({
      message: "Proceed with action?",
      initialValue: true,
    });
    if (p.isCancel(response) || !response) {
      p.cancel("Operation cancelled");
      process.exit(0);
    }
  } else {
    p.log.info("Auto-accepting: Proceeding with action");
  }

  // Action happens here
}
```

**Why:** This pattern enables both interactive and automated workflows. The `-y`/`--yes` flag is parsed in `src/cli.ts` and passed to all commands.

### 2. Git Commands - Use Bun.spawn(), NOT template literals

**❌ WRONG - Breaks with git format strings:**
```typescript
await $`git log --pretty=format:%H|%s|%an|%ai`;
// Bun interprets %H, %s, %an, %ai as shell commands
```

**✅ CORRECT - Use array arguments:**
```typescript
const formatString = "%H|%s|%an|%ai";
const proc = Bun.spawn(
  ["git", "log", `--pretty=format:${formatString}`],
  { stdout: "pipe", stderr: "pipe" }
);
const output = await new Response(proc.stdout).text();
```

**Why:** Bun's `$` template literal performs shell interpolation, treating git format placeholders as commands. Always use `Bun.spawn()` with array arguments for git commands.

### 3. Git Status Parsing - Position-Sensitive Format

**❌ WRONG - Breaks position parsing:**
```typescript
const status = await $`git status --porcelain`.text();
const lines = status.trim().split("\n"); // .trim() shifts positions!
```

**✅ CORRECT - Preserve exact positions:**
```typescript
const proc = Bun.spawn(["git", "status", "--porcelain"], {
  stdout: "pipe",
  stderr: "pipe",
});
const status = await new Response(proc.stdout).text();
const lines = status.split("\n").filter(Boolean); // NO .trim()!

// Git status format: XY filename
// X = index status (position 0)
// Y = working tree status (position 1)
const indexStatus = line[0];
const workTreeStatus = line[1];
```

**Why:** Git's porcelain format is position-sensitive. The first character represents index status, the second represents working tree status. Using `.trim()` removes leading spaces and shifts positions, breaking the parser.

### 4. Spinner State Management

**❌ WRONG - Creates new spinner mid-operation:**
```typescript
spinner.start("Starting task...");
// ... do work ...
spinner.start("Next step..."); // Kills previous spinner!
```

**✅ CORRECT - Update existing spinner:**
```typescript
spinner.start("Starting task...");
// ... do work ...
spinner.message("Next step..."); // Updates message
// ... do work ...
spinner.stop("Done!");
```

**Why:** Starting a new spinner kills the previous one. Use `.message()` to update the running spinner's text.

### 5. Git Output During Spinner

**❌ WRONG - Git output interferes with spinner:**
```typescript
spinner.start("Pushing...");
await $`git push`; // Outputs to console, breaks spinner UI
spinner.stop("Done!");
```

**✅ CORRECT - Pipe git output:**
```typescript
spinner.start("Pushing...");
const proc = Bun.spawn(["git", "push"], {
  stdout: "pipe", // Don't use "inherit"!
  stderr: "pipe",
});
await proc.exited;
spinner.stop("Done!");
```

**Why:** When git commands output directly to console (stdout: "inherit"), they interfere with the spinner's rendering. Always pipe output during spinner operations.

### 6. OpenAI Reasoning Output

**Problem:** When `reasoning_effort` is set to "low"/"medium"/"high", the AI includes reasoning text before the actual response, breaking regex parsers.

**Solution:** For structured outputs that need regex parsing, set `reasoning_effort: "none"`:
```typescript
const response = await client.chat.completions.create({
  model: config.model || "gpt-5.2",
  messages: [{ role: "user", content: prompt }],
  temperature: 1,
  reasoning_effort: "none", // Disables reasoning phase
});
```

**Fallback Parsing:** Always include fallback parsing for free-form responses:
```typescript
// Try structured format first
const typeMatch = content.match(/TYPE:\s*(\w+)/);
const nameMatch = content.match(/NAME:\s*([^\n]+)/);

// Fallback to free-form parsing
if (!typeMatch || !nameMatch) {
  // Extract from natural language response
}
```

---

## Key Services

### [/src/services/commit.ts](src/services/commit.ts)

**`generateAndCommit(options)`**
- Stages all changes (if not already staged)
- Filters out large files (>100KB) and migrations
- Generates conventional commit message via OpenAI
- Executes commit with confirmation
- Returns commit message or null if cancelled

**Usage:**
```typescript
const { generateAndCommit } = await import("../services/commit.ts");
const message = await generateAndCommit({
  confirmBeforeCommit: true,
});
```

### [/src/services/branch.ts](src/services/branch.ts)

**`analyzeBranchName()`**
- Analyzes staged OR unstaged changes (all together)
- Generates branch name with type (feature/bugfix/chore/refactor)
- Includes description of changes
- Returns `BranchSuggestion | null`

**Usage:**
```typescript
const { analyzeBranchName } = await import("../services/branch.ts");
const suggestion = await analyzeBranchName();
// suggestion = { name: "feature/add-authentication", type: "feature", description: "..." }
```

### [/src/services/release.ts](src/services/release.ts)

**`createRelease(options)`**
- Validates repository state (must be on base branch, no uncommitted changes)
- Analyzes commits since last version tag
- Uses AI to suggest version bump type (major/minor/patch)
- Generates release title and notes via OpenAI
- Creates git tag and pushes to origin
- Creates GitHub release (if GitHub remote exists)
- Returns `ReleaseResult | null`

**Usage:**
```typescript
const { createRelease } = await import("../services/release.ts");
const result = await createRelease({
  autoYes: false,
  versionType: "minor", // Optional: skip AI suggestion
});
// result = { version: "v1.2.0", releaseUrl: "https://github.com/..." }
```

---

## Common Workflows

### Auto Mode Flow
1. Check current branch
2. If on main/master → create new branch
3. Stage all changes
4. Generate and commit with AI
5. Push to origin (set upstream if needed)
6. Create GitHub PR (if GitHub remote exists)
7. If YOLO mode: auto-merge PR and delete feature branch

### Cleanup Command Flow
1. Optionally switch to base branch (main/master)
2. Fetch from origin to get latest remote state
3. Find local branches that are merged into `origin/base`
4. Filter out current branch and protected branches (main, master, develop, staging)
5. Only consider branches that exist on remote (preserves local-only branches)
6. Optionally delete merged remote branches from origin
7. Delete local merged branches with confirmation

### Release Command Flow
1. Validate on base branch with no uncommitted changes
2. Find latest version tag (or start from v0.0.1)
3. Get commits since last tag
4. Ask AI to suggest version bump type (major/minor/patch)
5. Generate release title and notes via AI
6. Create git tag locally
7. Push tag to origin
8. Create GitHub release (if GitHub remote exists)

### Adding a New Command

1. Create command file in `/src/commands/`
2. Extract reusable logic to `/src/services/` if needed
3. Add command to CLI in `/src/cli.ts`:
   - Add to `runInteractive()` options
   - Add to command validation array
   - Add to command execution switch
4. Update help text in `showHelp()`
5. Update README.md with usage examples

---

## Git Operations Reference

### Safe Git Commands

```typescript
// Current branch
import { getCurrentBranch } from "../utils/git.ts";
const branch = await getCurrentBranch();

// Check for unstaged changes
import { hasUnstagedChanges } from "../utils/git.ts";
const hasChanges = await hasUnstagedChanges();

// Stage all changes
import { stageAllChanges } from "../utils/git.ts";
await stageAllChanges();

// Get staged changes
import { getStagedChanges } from "../utils/git.ts";
const changes = await getStagedChanges();
// Returns: Array<{ path: string, status: string, diff: string, skipped: boolean }>

// Create and checkout branch
import { createAndCheckoutBranch } from "../utils/git.ts";
await createAndCheckoutBranch("feature/new-feature");

// Push to origin
import { pushToOrigin } from "../utils/git.ts";
await pushToOrigin(true); // true = set upstream

// Get commits between branches
import { getBranchCommits } from "../utils/git.ts";
const commits = await getBranchCommits();
// Returns: Array<{ hash: string, message: string, author: string, date: string }>

// Get commits since a tag
import { getCommitsSinceTag } from "../utils/git.ts";
const commits = await getCommitsSinceTag("v1.0.0");
// Returns: Array<{ hash: string, message: string, author: string, date: string }>

// Get latest version tag
import { getLatestVersionTag } from "../utils/git.ts";
const tag = await getLatestVersionTag();
// Returns: "v1.2.3" or null

// Branch operations for cleanup
import { getLocalBranches, branchExistsOnRemote, isBranchMerged, deleteLocalBranch } from "../utils/git.ts";
const branches = await getLocalBranches(); // Returns: string[]
const exists = await branchExistsOnRemote("feature/my-branch"); // Returns: boolean
const merged = await isBranchMerged("feature/my-branch", "origin/main"); // Returns: boolean
await deleteLocalBranch("feature/my-branch"); // Deletes local branch
```

---

## Debugging Tips

### 1. Git Command Issues
If a git command fails unexpectedly:
- Check if using `Bun.spawn()` with array arguments (not `$` template)
- Verify stdout/stderr are piped, not inherited
- Add temporary logging to see raw output:
  ```typescript
  const output = await new Response(proc.stdout).text();
  console.log("[DEBUG] Git output:", output);
  ```

### 2. Spinner Issues
If spinner hangs or shows wrong state:
- Ensure all git commands use `stdout: "pipe"`
- Use `spinner.message()` for updates, not `spinner.start()`
- Check that `spinner.stop()` is called on all code paths

### 3. AI Response Parsing
If AI responses aren't being parsed correctly:
- Set `reasoning_effort: "none"` for structured outputs
- Add logging to see raw AI response:
  ```typescript
  console.log("[DEBUG] AI Response:", content);
  ```
- Ensure fallback parsing handles free-form responses

---

## Testing Changes

Before committing changes:

1. Build the project:
   ```bash
   bun run build
   ```

2. Test the executable:
   ```bash
   ./git-ai [command]
   ```

3. Test in a git repository with:
   - Staged changes
   - Unstaged changes
   - Clean working tree
   - On main branch
   - On feature branch

4. Verify spinners stop correctly and don't hang

---

## GitHub Actions

- **CI** ([.github/workflows/ci.yml](.github/workflows/ci.yml)): Runs on push, builds for Linux/macOS/Windows
- **Release** ([.github/workflows/release.yml](.github/workflows/release.yml)): Triggers on version tags (`v*.*.*`), creates GitHub releases with platform-specific binaries

To create a release:
```bash
git tag v1.0.1
git push origin v1.0.1
```

---

## Common Pitfalls

1. **Don't use `$` template for git commands with special characters** - Use `Bun.spawn()`
2. **Don't `.trim()` git status output** - Position-sensitive format
3. **Don't start multiple spinners** - Update with `.message()` instead
4. **Don't use `stdout: "inherit"` during spinner** - Pipe output instead
5. **Don't forget `reasoning_effort: "none"` for structured AI outputs** - Prevents reasoning text from breaking parsers
6. **Don't hardcode fallback values** - Always include robust parsing with fallbacks

---

## Resources

- [Bun Documentation](https://bun.sh/docs)
- [@clack/prompts Documentation](https://github.com/natemoo-re/clack)
- [OpenAI API Reference](https://platform.openai.com/docs)
- [Octokit REST API](https://octokit.github.io/rest.js/)
