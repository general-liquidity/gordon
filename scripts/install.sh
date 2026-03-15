#!/bin/sh
# Gordon CLI installer script
# Usage: curl -fsSL https://raw.githubusercontent.com/general-liquidity/gordon-cli-dist/main/install.sh | sh
# Custom dir: GORDON_INSTALL_DIR="$HOME/.local/bin" curl -fsSL https://raw.githubusercontent.com/general-liquidity/gordon-cli-dist/main/install.sh | sh

set -e

REPO="${GORDON_DIST_REPO:-general-liquidity/gordon-cli-dist}"
BINARY_NAME="gordon"
INSTALL_METADATA_NAME="gordon-install.json"

# Colors for output (if terminal supports it)
if [ -t 1 ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[0;33m'
    BLUE='\033[0;34m'
    NC='\033[0m'
else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    NC=''
fi

info() {
    printf "${BLUE}info${NC}: %s\n" "$1"
}

success() {
    printf "${GREEN}success${NC}: %s\n" "$1"
}

warn() {
    printf "${YELLOW}warning${NC}: %s\n" "$1"
}

error() {
    printf "${RED}error${NC}: %s\n" "$1" >&2
    exit 1
}

# Detect OS
detect_os() {
    case "$(uname -s)" in
        Linux*)
            if grep -qi microsoft /proc/version 2>/dev/null; then
                echo "linux"
            else
                echo "linux"
            fi
            ;;
        Darwin*)
            echo "darwin"
            ;;
        MINGW*|MSYS*|CYGWIN*)
            echo "windows"
            ;;
        *)
            error "Unsupported operating system: $(uname -s)"
            ;;
    esac
}

# Detect architecture
detect_arch() {
    case "$(uname -m)" in
        x86_64|amd64)
            echo "x64"
            ;;
        arm64|aarch64)
            echo "arm64"
            ;;
        *)
            error "Unsupported architecture: $(uname -m)"
            ;;
    esac
}

# Get the latest version from GitHub
get_latest_version() {
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"v([^"]+)".*/\1/'
    elif command -v wget >/dev/null 2>&1; then
        wget -qO- "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"v([^"]+)".*/\1/'
    else
        error "Neither curl nor wget found. Please install one of them."
    fi
}

# Download file using curl or wget
download() {
    url="$1"
    output="$2"

    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$url" -o "$output"
    elif command -v wget >/dev/null 2>&1; then
        wget -q "$url" -O "$output"
    else
        error "Neither curl nor wget found. Please install one of them."
    fi
}

# Determine install directory
get_install_dir() {
    if [ -n "${GORDON_INSTALL_DIR:-}" ]; then
        mkdir -p "${GORDON_INSTALL_DIR}" 2>/dev/null || error "Cannot create install directory ${GORDON_INSTALL_DIR}"
        if [ ! -w "${GORDON_INSTALL_DIR}" ]; then
            error "Install directory is not writable: ${GORDON_INSTALL_DIR}"
        fi
        echo "${GORDON_INSTALL_DIR}"
        return
    fi

    if [ -w "/usr/local/bin" ]; then
        echo "/usr/local/bin"
    elif [ -d "$HOME/.local/bin" ] || mkdir -p "$HOME/.local/bin" 2>/dev/null; then
        echo "$HOME/.local/bin"
    else
        error "Cannot find a writable install directory"
    fi
}

# Check if directory is in PATH
check_path() {
    dir="$1"
    case ":$PATH:" in
        *":$dir:"*)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

main() {
    info "Installing Gordon CLI..."

    # Detect platform
    OS=$(detect_os)
    ARCH=$(detect_arch)
    info "Detected platform: ${OS}-${ARCH}"

    # Get version
    if [ -n "${GORDON_VERSION:-}" ]; then
        VERSION="$GORDON_VERSION"
        info "Using specified version: v${VERSION}"
    else
        info "Fetching latest version..."
        VERSION=$(get_latest_version)
        if [ -z "$VERSION" ]; then
            error "Failed to determine latest version"
        fi
        info "Latest version: v${VERSION}"
    fi

    # Construct download URL
    DOWNLOAD_URL="https://github.com/${REPO}/releases/download/v${VERSION}/${BINARY_NAME}-${OS}-${ARCH}"
    info "Downloading from: ${DOWNLOAD_URL}"

    # Create temporary directory
    TMP_DIR=$(mktemp -d)
    trap 'rm -rf "$TMP_DIR"' EXIT

    TMP_FILE="${TMP_DIR}/${BINARY_NAME}"

    # Download binary
    if ! download "$DOWNLOAD_URL" "$TMP_FILE"; then
        error "Failed to download Gordon CLI. Please check if the version and platform are correct."
    fi

    # Make executable
    chmod +x "$TMP_FILE"

    # Get install directory
    INSTALL_DIR=$(get_install_dir)
    INSTALL_PATH="${INSTALL_DIR}/${BINARY_NAME}"

    # Install binary
    info "Installing to ${INSTALL_PATH}..."
    if [ "$INSTALL_DIR" = "/usr/local/bin" ] && [ ! -w "$INSTALL_DIR" ]; then
        sudo mv "$TMP_FILE" "$INSTALL_PATH"
        sudo chmod +x "$INSTALL_PATH"
    else
        mv "$TMP_FILE" "$INSTALL_PATH"
        chmod +x "$INSTALL_PATH"
    fi

    # Verify installation
    if [ ! -x "$INSTALL_PATH" ]; then
        error "Installation failed: binary not found at ${INSTALL_PATH}"
    fi

    cat > "${INSTALL_DIR}/${INSTALL_METADATA_NAME}" <<EOF
{
  "channel": "script-unix",
  "installDir": "${INSTALL_DIR}",
  "version": "${VERSION}"
}
EOF

    success "Gordon CLI v${VERSION} installed successfully!"
    echo ""

    # Check if install directory is in PATH
    if ! check_path "$INSTALL_DIR"; then
        warn "Installation directory is not in your PATH"
        echo ""
        echo "Add the following to your shell profile (~/.bashrc, ~/.zshrc, etc.):"
        echo ""
        echo "    export PATH=\"\$PATH:${INSTALL_DIR}\""
        echo ""
    fi

    # WSL-specific guidance
    if grep -qi microsoft /proc/version 2>/dev/null; then
        echo ""
        info "WSL detected — Gordon is running as a Linux binary inside WSL."
        echo ""
        echo "  Tips:"
        echo "    - Your Windows files are at /mnt/c/Users/<username>/"
        echo "    - Config is stored at ~/.gordon/ (inside WSL)"
        if [ "$INSTALL_DIR" = "$HOME/.local/bin" ]; then
            echo "    - Ensure ~/.local/bin is in your PATH:"
            echo "        echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc"
        fi
        echo "    - For native Windows install, use PowerShell instead:"
        echo "        irm https://raw.githubusercontent.com/general-liquidity/gordon-cli-dist/main/install.ps1 | iex"
        echo ""
    fi

    echo "Get started:"
    echo ""
    echo "    gordon --help     # Show available commands"
    echo "    gordon init       # Initialize Gordon in your project"
    echo "    gordon            # Start interactive mode"
    echo ""
}

main
