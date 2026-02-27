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

# Remove PATH entries from shell config
remove_path_from_shell() {
    local config_file=$1

    if [ ! -f "$config_file" ]; then
        return
    fi

    if ! grep -q "# Git AI CLI - Add to PATH" "$config_file" 2>/dev/null; then
        return
    fi

    print_info "Removing PATH configuration from $config_file"

    # Create backup
    cp "$config_file" "$config_file.backup.$(date +%s)"

    # Remove the Git AI CLI section
    sed -i '/# Git AI CLI - Add to PATH/d' "$config_file" 2>/dev/null || true
    sed -i '/fish_add_path.*\.local\/bin/d' "$config_file" 2>/dev/null || true
    sed -i '/export PATH=.*\.local\/bin.*git-ai/d' "$config_file" 2>/dev/null || true

    # Clean up empty lines
    sed -i '/^$/N;/^\n$/d' "$config_file" 2>/dev/null || true

    print_success "Removed PATH configuration from $config_file"
    print_info "Backup saved to: $config_file.backup.*"
}

# Main uninstallation
main() {
    print_header "🗑️  Git AI CLI Uninstaller"

    BIN_DIR="$HOME/.local/bin"
    PRIMARY_BIN="git-ai-cli"
    ALIASES=("gitai" "commitfox")
    BIN_PATH="$BIN_DIR/$PRIMARY_BIN"
    CONFIG_DIR="$HOME/.config/git-ai"
    FOUND_INSTALL=0

    # Check if installed
    if [ -e "$BIN_PATH" ] || [ -L "$BIN_PATH" ]; then
        FOUND_INSTALL=1
    fi
    for alias in "${ALIASES[@]}"; do
        if [ -e "$BIN_DIR/$alias" ] || [ -L "$BIN_DIR/$alias" ]; then
            FOUND_INSTALL=1
            break
        fi
    done
    if [ -d "$CONFIG_DIR" ]; then
        FOUND_INSTALL=1
    fi

    if [ "$FOUND_INSTALL" -eq 0 ]; then
        print_warning "Git AI CLI does not appear to be installed"
        print_info "Binary not found at: $BIN_PATH"
        print_info "Config not found at: $CONFIG_DIR"
        exit 0
    fi

    if [ -f "$BIN_PATH" ] || [ -L "$BIN_PATH" ]; then
        print_info "Found binary at: $BIN_PATH"
    fi
    for alias in "${ALIASES[@]}"; do
        alias_path="$BIN_DIR/$alias"
        if [ -L "$alias_path" ] || [ -f "$alias_path" ]; then
            print_info "Found alias at: $alias_path"
        fi
    done

    if [ -d "$CONFIG_DIR" ]; then
        print_info "Found config at: $CONFIG_DIR"
    fi

    # Confirm uninstallation
    echo ""
    print_warning "This will remove Git AI CLI commands from your system"
    read -p "Are you sure you want to uninstall? (y/N): " confirm

    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        print_info "Uninstallation cancelled"
        exit 0
    fi

    print_header "🗑️  Removing Files"

    # Remove binary
    if [ -f "$BIN_PATH" ] || [ -L "$BIN_PATH" ]; then
        rm "$BIN_PATH"
        print_success "Removed $BIN_PATH"
    fi

    # Remove managed aliases
    for alias in "${ALIASES[@]}"; do
        alias_path="$BIN_DIR/$alias"
        if [ -L "$alias_path" ]; then
            target="$(readlink "$alias_path" || true)"
            if [ "$target" = "$PRIMARY_BIN" ] || [ "$target" = "$BIN_PATH" ]; then
                rm "$alias_path"
                print_success "Removed alias $alias_path"
            else
                print_warning "Skipped alias $alias_path (points elsewhere: $target)"
            fi
        elif [ -f "$alias_path" ]; then
            print_warning "Skipped $alias_path (regular file; not removing automatically)"
        fi
    done

    # Ask about removing config
    echo ""
    if [ -d "$CONFIG_DIR" ]; then
        read -p "Remove configuration folder (includes API key)? (y/N): " remove_config

        if [[ "$remove_config" =~ ^[Yy]$ ]]; then
            print_header "⚙️  Cleaning Configuration"

            rm -rf "$CONFIG_DIR"
            print_success "Removed $CONFIG_DIR"
        else
            print_info "Keeping configuration at $CONFIG_DIR"
            print_warning "You can manually remove it later with: rm -rf $CONFIG_DIR"
        fi
    fi

    # Ask about removing PATH from shell configs
    echo ""
    read -p "Remove PATH configuration from shell configs? (y/N): " remove_path

    if [[ "$remove_path" =~ ^[Yy]$ ]]; then
        print_header "⚙️  Cleaning Shell Configuration"

        # Remove from common shell configs
        for config in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.config/fish/config.fish"; do
            if [ -f "$config" ]; then
                remove_path_from_shell "$config"
            fi
        done
    else
        print_info "Keeping PATH configuration in shell"
        print_warning "Note: ~/.local/bin may still be in your PATH"
    fi

    print_header "✨ Uninstallation Complete"

    print_success "Git AI CLI has been removed from your system"
    echo ""

    if [[ "$remove_path" =~ ^[Yy]$ ]]; then
        print_info "Please restart your terminal or source your shell config to apply changes"
    fi

    echo ""
}

# Run main function
main
