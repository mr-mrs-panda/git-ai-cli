# Contributing to Git AI CLI

Thanks for your interest in contributing! This project is primarily maintained by [@pandapknaepel](https://github.com/mr-mrs-panda) with the help of Claude Code.

## Development Setup

### Prerequisites

- [Bun](https://bun.sh) v1.3.4 or higher
- Git
- OpenAI API key (for testing AI features)

### Getting Started

1. **Clone the repository**
   ```bash
   git clone https://github.com/mr-mrs-panda/git-ai-cli.git
   cd git-ai-cli
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```

3. **Run in development mode**
   ```bash
   bun run dev
   ```

4. **Run tests**
   ```bash
   bun test
   ```

5. **Build the binary**
   ```bash
   bun run build
   ```

## Code Style

- TypeScript with strict mode
- Use `async/await` over raw Promises
- Prefer descriptive variable names
- Add JSDoc comments for public functions
- Follow Conventional Commits for commit messages

## Project Structure

```
src/
├── cli.ts              # Main entry point and CLI argument parsing
├── commands/           # Command implementations
│   ├── auto.ts         # Smart workflow command
│   ├── commit.ts       # Commit message generation
│   ├── create-branch.ts
│   ├── pr-suggest.ts
│   ├── release.ts
│   ├── cleanup.ts
│   └── settings.ts
├── services/           # Business logic
│   ├── branch.ts
│   ├── commit.ts
│   ├── github.ts
│   ├── pr.ts
│   └── release.ts
└── utils/              # Utility functions
    ├── config.ts       # Configuration management
    ├── git.ts          # Git operations
    └── openai.ts       # OpenAI API integration
```

## Submitting Changes

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`bun test`)
5. Commit with a descriptive message following [Conventional Commits](https://www.conventionalcommits.org/)
6. Push to your fork
7. Open a Pull Request

## Reporting Issues

When reporting bugs, please include:

- Your OS and version
- Bun version (`bun --version`)
- Steps to reproduce
- Expected vs actual behavior
- Any error messages

## Questions?

Feel free to open an issue for any questions or suggestions!

