# Git AI CLI

[![CI](https://github.com/mr-mrs-panda/git-ai-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/mr-mrs-panda/git-ai-cli/actions/workflows/ci.yml)
[![Release](https://github.com/mr-mrs-panda/git-ai-cli/actions/workflows/release.yml/badge.svg)](https://github.com/mr-mrs-panda/git-ai-cli/actions/workflows/release.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

AI-powered Git commit message generator and PR suggestion tool built with Bun.

## Features

- **🚀 Auto Mode (Recommended)**: Intelligent end-to-end workflow for quick changes
  - Analyzes your current state and determines what needs to be done
  - If on main/master: creates a new branch based on your changes
  - Stages and commits changes with AI-generated message
  - Pushes to origin
  - Creates GitHub Pull Request automatically
  - Perfect for quick fixes and features

- **Auto Commit Generator**: Analyzes your staged changes and generates meaningful commit messages using AI
  - Automatically skips large files (>100KB) and migration files
  - Uses conventional commit format
  - Interactive TUI for reviewing and confirming commits
  - Optional automatic push to origin

- **Create Branch**: Analyzes your changes and suggests appropriate branch names
  - AI-powered branch name generation
  - Automatically determines branch type (feature/bugfix/chore/refactor)
  - Creates and switches to the new branch
  - Keeps your changes staged and ready to commit

- **PR Suggestion**: Generates pull request titles and descriptions based on:
  - Branch name
  - Commit messages
  - Branch comparison with base branch
  - Copy to clipboard functionality
  - Direct GitHub PR creation with token management

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
  "model": "gpt-5.2",
  "temperature": 1,
  "reasoningEffort": "low"
}
```

### Configure Interactively

Use the settings command for easy configuration:

```bash
git-ai settings
```

This allows you to:
- Change AI model (GPT-5.2, GPT-5.2 Pro, GPT-5.1, o3, etc.)
- Adjust reasoning effort (none, low, medium, high, xhigh)
- Update temperature
- Change your API key
- Reset to defaults

### Configuration Options

| Option | Description | Default | Range/Options |
|--------|-------------|---------|---------------|
| `model` | AI model to use | `gpt-5.2` | See available models below |
| `reasoningEffort` | Reasoning depth | `low` | `none`, `low`, `medium`, `high`, `xhigh` |
| `temperature` | Creativity vs consistency | `1` | `0.0` - `2.0` |
| `openaiApiKey` | Your OpenAI API key | - | `sk-...` |

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
git-ai auto            # Smart workflow (recommended)
git-ai auto -y         # Auto mode with all prompts auto-accepted (blind mode)
git-ai create-branch   # Create branch from changes
git-ai auto-commit     # Generate commit message
git-ai pr-suggest      # Generate PR suggestion
git-ai settings        # Configure settings
git-ai --help          # Show help
git-ai --version       # Show version
```

### Commands

#### Auto Mode (Recommended)
The intelligent workflow that handles everything for you:
```bash
# Make your changes
# Run auto mode - it figures out what to do
git-ai auto

# Or use blind mode to auto-accept all prompts
git-ai auto -y
git-ai auto --yes
```

**What it does:**
1. If you're on `main`/`master`: Creates a new branch based on your changes
2. Stages all changes
3. Generates and commits with AI
4. Pushes to origin
5. Creates a GitHub Pull Request

**Blind Mode (`-y` or `--yes` flag):**
- Auto-accepts all prompts without user confirmation
- Perfect for CI/CD pipelines or when you trust the AI completely
- Still shows all generated content (branch names, commit messages, PR descriptions)
- Skips PR creation if GitHub token is not configured

Perfect for quick fixes and features - just make your changes and run `git-ai auto`!

#### Auto Commit
Generates a commit message from your staged changes:
```bash
# Stage your changes first
git add .

# Run the tool and select "Generate commit message"
git-ai auto-commit
```

#### Create Branch
Analyzes your changes and creates a new branch with an AI-generated name:
```bash
# Make some changes (staged or unstaged)
# Run the tool and select "Create branch from changes"
git-ai create-branch
```

The tool will:
1. Analyze your changes
2. Suggest a branch name like `feature/add-authentication` or `bugfix/fix-login-error`
3. Create and switch to the new branch
4. Keep your changes staged

#### PR Suggestion
Generates PR title and description from your branch commits:
```bash
# Make sure you're on a feature branch with commits
# Run the tool and select "Generate PR title & description"
git-ai pr-suggest
```

The tool can also create the GitHub PR directly if you have a `GITHUB_TOKEN` configured.

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
