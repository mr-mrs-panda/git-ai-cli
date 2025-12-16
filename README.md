# Git AI CLI

AI-powered Git commit message generator and PR suggestion tool built with Bun.

## Features

- **Auto Commit Generator**: Analyzes your staged changes and generates meaningful commit messages using AI
  - Automatically skips large files (>100KB) and migration files
  - Uses conventional commit format
  - Interactive TUI for reviewing and confirming commits

- **PR Suggestion**: Generates pull request titles and descriptions based on:
  - Branch name
  - Commit messages
  - Branch comparison with base branch
  - Copy to clipboard functionality

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
  "temperature": 0.7,
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
| `temperature` | Creativity vs consistency | `0.7` | `0.0` - `2.0` |
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
git-ai auto-commit    # Generate commit message
git-ai pr-suggest     # Generate PR suggestion
git-ai settings       # Configure settings
git-ai --help         # Show help
git-ai --version      # Show version
```

### Commands

#### Auto Commit
Generates a commit message from your staged changes:
```bash
# Stage your changes first
git add .

# Run the tool and select "Generate commit message"
git-ai
```

#### PR Suggestion
Generates PR title and description from your branch commits:
```bash
# Make sure you're on a feature branch with commits
# Run the tool and select "Generate PR title & description"
git-ai
```

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
- [OpenAI API](https://platform.openai.com/) - GPT-4 Turbo for AI generation
- [@clack/prompts](https://github.com/natemoo-re/clack) - Modern CLI prompts
- TypeScript - Type-safe development
