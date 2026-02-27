# Git AI CLI

[![CI](https://github.com/mr-mrs-panda/git-ai-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/mr-mrs-panda/git-ai-cli/actions/workflows/ci.yml)
[![Release](https://github.com/mr-mrs-panda/git-ai-cli/actions/workflows/release.yml/badge.svg)](https://github.com/mr-mrs-panda/git-ai-cli/actions/workflows/release.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

AI-powered Git commit message generator and PR suggestion tool built with Bun.

[demo.webm](https://github.com/user-attachments/assets/84d26b0c-3c78-45eb-8e0e-5fef7b0b7a44)

## Features

- **🚀 Auto Mode**: Intelligent end-to-end workflow for quick changes
  - Analyzes your current state and determines what needs to be done
  - If on main/master: creates a new branch based on your changes
  - Stages and commits changes with AI-generated message
  - Pushes to origin
  - Creates GitHub Pull Request automatically
  - YOLO mode: auto-merge PR and delete branch after merge
  - Perfect for quick fixes and features

- **📋 Prepare Command**: Smart workflow to prepare for a new feature
  - Handles uncommitted changes intelligently (commit, stash, or discard)
  - Automatically checks out to main/master
  - Pulls latest changes from remote
  - If you chose stash: reapplies changes on main so you can work fresh
  - Perfect before starting a new feature branch

- **Commit Generator**: Analyzes all your changes and generates meaningful commit messages using AI
  - Works with all changes: staged, unstaged, and untracked files
  - Automatically skips large files (>100KB) and migration files
  - Uses conventional commit format
  - Interactive TUI for confirming generated messages
  - Optional automatic push to origin
  - Perfect for IDEs like Rider that don't work with git staging

- **Branch Creator**: Analyzes all your changes and suggests appropriate branch names
  - Works with all changes: staged, unstaged, and untracked files
  - AI-powered branch name generation
  - Automatically determines branch type (feature/bugfix/chore/refactor)
  - Creates and switches to the new branch
  - Perfect for analyzing all your work regardless of staging status

- **PR Generator**: Generates pull request titles and descriptions based on:
  - Branch name
  - Commit messages
  - Branch comparison with base branch
  - Copy to clipboard functionality
  - Direct GitHub PR creation with token management

- **Release Creator**: Automates GitHub releases with AI
  - Analyzes commits since last release
  - Fetches merged PR titles and descriptions for richer context
  - Determines semantic version bump (major/minor/patch) using commits and PR labels
  - Generates comprehensive release notes with PR references
  - Automatically switches to main/master and pulls latest changes
  - Creates GitHub release with changelog
  - Tags the release automatically

- **Branch Cleanup**: Clean up merged branches
  - Finds local branches merged into remote
  - Safe deletion with confirmation
  - Prevents deletion of current branch and protected branches
  - Keeps your repository organized

## Quick Installation

Run the install script to set up `git-ai` on your system:

```bash
./install.sh
```

The installer will:
- Build the application
- Install it to `~/.local/bin/git-ai`
- Add `~/.local/bin` to your PATH (if needed)

After installation, restart your terminal or run:
```bash
source ~/.bashrc        # For bash
source ~/.zshrc         # For zsh
source ~/.config/fish/config.fish  # For fish
```

Then run the tool:
```bash
git-ai
```

**On first run**, you'll be prompted to enter your OpenAI API key. The tool will save it to `~/.config/git-ai/config.json` for future use.

## Configuration

Configuration is stored in `~/.config/git-ai/config.json`:

```json
{
  "openaiApiKey": "sk-your-api-key-here",
  "githubToken": "ghp-your-github-token-here",
  "model": "gpt-5.2",
  "temperature": 1,
  "reasoningEffort": "low",
  "preferences": {
    "commit": {
      "alwaysStageAll": true,
      "defaultMode": "grouped",
      "autoPushOnYes": false
    },
    "pullRequest": {
      "createAsDraft": true
    }
  }
}
```

### GitHub Token (Optional)

To enable GitHub PR creation and releases, configure a GitHub token:

1. Generate a token at: https://github.com/settings/tokens
2. Required scopes: `repo` (for private repos) or `public_repo` (for public repos only)
3. Add to config via `git-ai settings` or set `GITHUB_TOKEN` environment variable

The tool will fall back to prompting you for a token when needed if not configured.

### Configure Interactively

Use the settings command for easy configuration:

```bash
git-ai settings
```

This allows you to:
- Change AI model (GPT-5.2, GPT-5.2 Pro, GPT-5.1, o3, etc.)
- Adjust reasoning effort (none, low, medium, high, xhigh)
- Update temperature
- Configure commit behavior (grouped/single, always stage all, `commit -y` auto-push)
- Configure pull request behavior (draft by default or not)
- Change your API key
- Reset to defaults

### Configuration Options

| Option | Description | Default | Range/Options |
|--------|-------------|---------|---------------|
| `model` | AI model to use | `gpt-5.2` | See available models below |
| `reasoningEffort` | Reasoning depth | `low` | `none`, `low`, `medium`, `high`, `xhigh` |
| `temperature` | Creativity vs consistency | `1` | `0.0` - `2.0` |
| `preferences.commit.defaultMode` | Default commit mode | `grouped` | `grouped`, `single` |
| `preferences.commit.alwaysStageAll` | Always stage all changes before commit | `true` | `true`, `false` |
| `preferences.commit.autoPushOnYes` | Auto-push on `commit -y` / `auto -y` | `false` | `true`, `false` |
| `preferences.pullRequest.createAsDraft` | Create PRs as draft by default | `true` | `true`, `false` |
| `openaiApiKey` | Your OpenAI API key | - | `sk-...` |
| `githubToken` | GitHub token for PR/release features | - | `ghp-...` or `GITHUB_TOKEN` env var |

### Available Models

| Model | Reasoning Levels | Best For |
|-------|-----------------|----------|
| `gpt-5.2` | none, low, medium, high | General purpose, fast on 'none', deep on 'high' |
| `gpt-5.2-chat` | none, low, medium, high | Optimized for conversations |
| `gpt-5.2-pro` | high, xhigh | Complex tasks, maximum reasoning |
| `gpt-5.1` | none, low, medium, high | Previous generation |
| `gpt-5.1-codex` | none, low, medium, high | Optimized for code |
| `gpt-5-mini` | low, medium | Cost-effective, lighter |
| `gpt-5-nano` | low, medium | Very lightweight |
| `o3` | low, medium, high | Previous generation reasoning |
| `o3-mini` | low, medium, high | Lighter o3 variant |

### Reasoning Effort Levels

- **none**: No reasoning phase (fastest, most cost-effective)
- **low**: Minimal reasoning (balanced speed and quality)
- **medium**: Moderate reasoning depth
- **high**: Deep reasoning (slower, more thorough)
- **xhigh**: Maximum reasoning (GPT-5.2 Pro only)

You can also edit the config file directly with your favorite editor.

## Manual Setup (Alternative)

If you prefer manual installation:

1. Install dependencies:
```bash
bun install
```

2. Run the CLI:
```bash
bun run src/cli.ts
```

3. You'll be prompted for your OpenAI API key on first run

## Usage

The CLI supports both interactive and direct command modes:

### Interactive Mode
Simply run without arguments to get an interactive menu:
```bash
git-ai
```

### Direct Commands
Run specific commands directly:
```bash
git-ai auto            # Smart workflow
git-ai auto -y         # Auto mode with all prompts auto-accepted (blind mode)
git-ai auto --yolo     # YOLO mode: auto-merge PR and delete branch
git-ai auto --release  # Release mode: full workflow + merge + release
git-ai prepare         # Prepare for new feature
git-ai branch          # Create branch from changes
git-ai commit          # Generate commit message
git-ai commit --single # Force single-commit mode
git-ai commit --grouped # Force grouped-commit mode
git-ai pr              # Generate PR suggestion
git-ai release         # Create a GitHub release (includes PRs by default)
git-ai release --no-prs  # Create release without PR info
git-ai cleanup         # Local cleanup: delete merged branches + merged worktrees
git-ai worktree social-media-master  # Create ../<project>-social-media-master from main
git-ai settings        # Configure settings
git-ai --help          # Show help
git-ai --version       # Show version
```

### Commands

#### Auto Mode
The intelligent workflow that handles everything for you:
```bash
# Make your changes
# Run auto mode - it figures out what to do
git-ai auto

# Or use blind mode to auto-accept all prompts
git-ai auto -y
git-ai auto --yes

# Or use YOLO mode for maximum automation
git-ai auto --yolo

# Or use Release mode for full release workflow
git-ai auto --release
```

**What it does:**
1. If you're on `main`/`master`: Creates a new branch based on your changes
2. Stages and commits based on your commit settings
3. Generates and commits with AI
4. Pushes to origin
5. Creates a GitHub Pull Request (draft behavior from settings)

**Blind Mode (`-y` or `--yes` flag):**
- Auto-accepts all prompts without user confirmation
- Perfect for CI/CD pipelines or when you trust the AI completely
- Still shows all generated content (branch names, commit messages, PR descriptions)
- Skips PR creation if GitHub token is not configured

**YOLO Mode (`--yolo` flag):**
- Auto-merges the created PR after creation
- Deletes the feature branch after successful merge
- Maximum automation for rapid deployments
- Does NOT imply blind mode (combine with `-y` for no prompts)

**Release Mode (`--release` flag):**
- Enables YOLO mode automatically (implies `--yolo`)
- After PR merge, waits for GitHub to process
- Switches to main/master and pulls latest changes
- Automatically creates a new release with AI-generated notes
- Perfect for quick hotfixes that need immediate release
- Does NOT imply blind mode (combine with `-y` for no prompts)

Perfect for quick fixes and features - just make your changes and run `git-ai auto`!

#### Prepare for Feature
Prepares your repository for starting a new feature by handling uncommitted changes and syncing with the base branch:
```bash
# You're on a feature branch with uncommitted changes
git-ai prepare

# Or use blind mode to auto-abort if there are changes
git-ai prepare -y
```

**What it does:**
1. Detects if you're on a feature branch or main/master
2. If on feature branch with uncommitted changes, offers three options:
   - **Commit**: Stages all changes (including untracked), generates AI commit message, commits them
   - **Stash**: Temporarily saves your changes, then restores them on main
   - **Discard**: Resets branch to HEAD (destructive, requires confirmation)
   - **Abort**: Cancels the operation and keeps changes as-is
3. Checks out to main/master (if not already there)
4. Pulls latest changes from remote
5. If you stashed: Reapplies your changes on main so you're ready to create a new feature branch

**Works with all changes:**
- Staged changes
- Unstaged modifications
- Untracked files
- Perfect for any workflow, including IDEs that don't use git staging

**Typical workflow:**
```bash
# You're working on feature/old-feature with uncommitted changes
git-ai prepare

# Choose "Stash"
# Now you're on main with your previous changes ready
# Create a new feature branch
git-ai branch   # or git checkout -b feature/new-feature
```

#### Commit
Generates a commit message from all your changes and commits them:
```bash
# No need to stage first - git-ai handles everything
# Just run:
git-ai commit

# Works with:
# - Staged changes
# - Unstaged modifications  
# - Untracked files
```

#### Branch
Analyzes all your changes and creates a new branch with an AI-generated name:
```bash
# Make some changes (staged, unstaged, or untracked)
# Create branch from changes
git-ai branch
```

The tool will:
1. Analyze your changes
2. Suggest a branch name like `feature/add-authentication` or `bugfix/fix-login-error`
3. Create and switch to the new branch
4. Keep your changes staged

#### PR
Generates PR title and description from your branch commits:
```bash
# Make sure you're on a feature branch with commits
# Generate PR title & description
git-ai pr
```

The tool can also create the GitHub PR directly if you have a GitHub token configured.

#### Release
Creates a GitHub release with AI-generated release notes:
```bash
# Create a release (can be run from any branch)
git-ai release

# Create release without PR information
git-ai release --no-prs

# Auto-accept all prompts (uses AI-suggested version)
git-ai release -y
```

**What it does:**
1. Switches to main/master branch if not already there
2. Pulls latest changes from origin
3. Analyzes all commits since the last release/tag
4. Fetches merged PRs for richer context (if GitHub token available)
5. Determines appropriate semantic version bump (major, minor, or patch)
6. Generates comprehensive release notes with AI (including PR references)
7. Creates a new Git tag
8. Publishes the release to GitHub

**PR Integration (default):**
- Automatically fetches merged PRs since last release
- Uses PR titles and descriptions for better release notes
- Considers PR labels (e.g., `breaking-change`, `enhancement`) for version bump
- Can be disabled with `--no-prs` flag

Requires a GitHub token to be configured.

#### Cleanup
Cleans up local branches that have been merged into `origin/main` or `origin/master`:
```bash
# Delete merged branches
git-ai cleanup
```

**What it does:**
1. Fetches from `origin` and checks which local branches are merged into `origin/main` or `origin/master`
2. Shows you the list of branches to be deleted
3. Removes any non-main worktrees attached to those merged branches (`--force`, with folder cleanup fallback)
4. Confirms before deletion
5. Deletes local merged branches only (never deletes remote branches), even if `origin/<branch>` was already deleted
6. Skips origin-missing branches that are not merged into `origin/main` or `origin/master`

Protected branches (main, master, develop, staging) are never deleted.

#### Worktree
Creates a new worktree and branch from `main` in a sibling folder:
```bash
# Create branch + worktree from main
git-ai worktree social-media-master
```

**What it does:**
1. Validates the provided branch/worktree name with git branch rules
2. If you are on a non-`main` branch with uncommitted changes, it aborts
3. Switches to `main` (if needed) and requires `main` to be clean (no uncommitted changes)
4. Creates a new worktree at `../<project>-<sanitized-name>`
5. Creates a new branch with the original provided name from `main`

Folder names are sanitized to valid characters (`a-z`, `0-9`, `.`, `_`, `-`).

## Development

Run in development mode:
```bash
bun run dev
```

Build standalone executable:
```bash
bun run build
```

## Requirements

- Bun v1.3.4 or higher
- Git repository
- OpenAI API key

## File Size Limits

The tool automatically skips files that are:
- Larger than 100KB
- Migration files (based on common patterns)
- Deleted files

This ensures the AI analysis is fast and focused on meaningful code changes.

## Uninstallation

To remove git-ai from your system:

```bash
./uninstall.sh
```

The uninstaller will:
- Remove the `git-ai` binary from `~/.local/bin`
- Optionally remove the configuration folder (`~/.config/git-ai/`)
- Optionally remove PATH entries from shell configs
- Create backups of modified config files

## Technology Stack

- [Bun](https://bun.sh) - Fast JavaScript runtime
- [OpenAI API](https://platform.openai.com/) - OpenAI API for AI generation
- [@clack/prompts](https://github.com/natemoo-re/clack) - Modern CLI prompts
- TypeScript - Type-safe development

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
