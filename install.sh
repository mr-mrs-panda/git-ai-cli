#!/usr/bin/env bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print functions
print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_header() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

# Add PATH to shell config if needed
add_path_to_shell() {
    local shell_name=$1
    local config_file=$2
    local bin_dir=$3

    # Check if config file exists
    if [ ! -f "$config_file" ]; then
        return
    fi

    # Check if PATH already includes bin_dir
    if grep -q "$bin_dir" "$config_file" 2>/dev/null; then
        return
    fi

    print_info "Adding $bin_dir to PATH in $config_file"

    if [ "$shell_name" = "fish" ]; then
        echo "" >> "$config_file"
        echo "# Git AI CLI - Add to PATH" >> "$config_file"
        echo "fish_add_path \"$bin_dir\"" >> "$config_file"
    else
        echo "" >> "$config_file"
        echo "# Git AI CLI - Add to PATH" >> "$config_file"
        echo "export PATH=\"$bin_dir:\$PATH\"" >> "$config_file"
    fi

    print_success "Added $bin_dir to PATH"
}

# Detect shell
detect_shell() {
    if [ -n "$SHELL" ]; then
        basename "$SHELL"
    else
        basename "$(ps -p $$ -o comm=)"
    fi
}

# Get shell config file
get_config_file() {
    local shell_name=$1

    case "$shell_name" in
        fish)
            echo "$HOME/.config/fish/config.fish"
            ;;
        zsh)
            echo "$HOME/.zshrc"
            ;;
        bash)
            echo "$HOME/.bashrc"
            ;;
        *)
            echo "$HOME/.bashrc"
            ;;
    esac
}

# Main installation
main() {
    print_header "🤖 Git AI CLI Installer"

    # Check if bun is installed
    if ! command -v bun &> /dev/null; then
        print_error "Bun is not installed. Please install Bun first: https://bun.sh"
        exit 1
    fi

    print_success "Found Bun: $(bun --version)"

    print_header "📦 Building Application"

    # Install dependencies
    print_info "Installing dependencies..."
    bun install --silent
    print_success "Dependencies installed"

    # Build the application
    print_info "Building executable..."
    bun build src/cli.ts --compile --outfile git-ai-cli

    if [ ! -f "git-ai-cli" ]; then
        print_error "Build failed - executable not created"
        exit 1
    fi

    print_success "Built executable: git-ai-cli"

    print_header "📥 Installing to System"

    # Determine install location
    BIN_DIR="$HOME/.local/bin"

    # Create bin directory if it doesn't exist
    if [ ! -d "$BIN_DIR" ]; then
        print_info "Creating $BIN_DIR"
        mkdir -p "$BIN_DIR"
    fi

    PRIMARY_BIN="git-ai-cli"
    ALIASES=("gitai" "commitfox")
    PRIMARY_PATH="$BIN_DIR/$PRIMARY_BIN"

    # Install the primary executable
    print_info "Installing $PRIMARY_BIN to $BIN_DIR..."
    cp "$PRIMARY_BIN" "$PRIMARY_PATH"
    chmod +x "$PRIMARY_PATH"
    print_success "Installed to $PRIMARY_PATH"

    # Install aliases as symlinks when safe
    for alias in "${ALIASES[@]}"; do
        alias_path="$BIN_DIR/$alias"
        if [ -L "$alias_path" ]; then
            current_target="$(readlink "$alias_path" || true)"
            if [ "$current_target" = "$PRIMARY_BIN" ] || [ "$current_target" = "$PRIMARY_PATH" ]; then
                print_success "Alias already configured: $alias -> $PRIMARY_BIN"
                continue
            fi
            print_warning "Skipping alias '$alias' (already points elsewhere: $current_target)"
            continue
        fi

        if [ -e "$alias_path" ]; then
            print_warning "Skipping alias '$alias' (path already exists and is not a managed symlink)"
            continue
        fi

        ln -s "$PRIMARY_BIN" "$alias_path"
        print_success "Installed alias: $alias -> $PRIMARY_BIN"
    done

    # Detect shell and add to PATH if needed
    print_header "⚙️  Configuring Shell"

    shell_name=$(detect_shell)
    config_file=$(get_config_file "$shell_name")

    print_info "Detected shell: $shell_name"

    # Check if BIN_DIR is in PATH
    if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
        print_warning "$BIN_DIR is not in your PATH"
        add_path_to_shell "$shell_name" "$config_file" "$BIN_DIR"

        print_info "Please reload your shell or run:"
        echo ""
        if [ "$shell_name" = "fish" ]; then
            echo "  source $config_file"
        else
            echo "  source $config_file"
        fi
        echo ""
    else
        print_success "$BIN_DIR is already in PATH"
    fi

    print_header "✨ Installation Complete!"

    echo ""
    print_success "Git AI CLI has been installed successfully!"
    echo ""
    print_info "Next steps:"
    echo ""
    echo "  1. Reload your shell (or start a new terminal)"
    echo ""
    echo "  2. Run the tool:"
    echo "     ${BLUE}git-ai-cli${NC}"
    echo ""
    echo "     Aliases:"
    echo "     ${BLUE}gitai${NC}"
    echo "     ${BLUE}commitfox${NC}"
    echo ""
    echo "  3. You'll be prompted to enter your OpenAI API key on first run"
    echo "     Get your key from: https://platform.openai.com/api-keys"
    echo ""
    print_info "The tool will be installed at: $BIN_DIR/$PRIMARY_BIN"
    print_info "Aliases (when available) are installed at: $BIN_DIR/gitai and $BIN_DIR/commitfox"
    print_info "Configuration will be stored at: ~/.config/git-ai/config.json"
    echo ""

    # Offer to test immediately (if PATH is already set)
    if [[ ":$PATH:" == *":$BIN_DIR:"* ]]; then
        read -p "Would you like to run the tool now? (y/N): " run_now
        if [[ "$run_now" =~ ^[Yy]$ ]]; then
            echo ""
            "$PRIMARY_PATH"
        fi
    fi

    echo ""
    print_success "Enjoy using Git AI CLI! 🚀"
    echo ""
}

# Run main function
main
