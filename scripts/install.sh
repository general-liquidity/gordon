#!/bin/sh
# Gordon CLI installer script
# Usage: curl -fsSL https://raw.githubusercontent.com/general-liquidity/gordon-dist/main/install.sh | sh
# Custom dir: GORDON_INSTALL_DIR="$HOME/.local/bin" curl -fsSL https://raw.githubusercontent.com/general-liquidity/gordon-dist/main/install.sh | sh

set -e

REPO="${GORDON_DIST_REPO:-general-liquidity/gordon-dist}"
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

# Detect Linux libc — musl needs a different binary than glibc.
# Returns "musl" or "" (glibc / non-Linux).
detect_libc() {
    if [ "$(uname -s)" != "Linux" ]; then
        echo ""
        return
    fi
    if [ -f /etc/alpine-release ]; then
        echo "musl"
        return
    fi
    if command -v ldd >/dev/null 2>&1; then
        if ldd --version 2>&1 | grep -qi musl; then
            echo "musl"
            return
        fi
    fi
    echo ""
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

# Compute the SHA-256 of a file, printing the lowercase hex digest only.
# Returns non-zero if no sha256 tool is available.
sha256_of() {
    file="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$file" | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$file" | awk '{print $1}'
    else
        return 1
    fi
}

# Verify a downloaded asset against the committed SHA256SUMS.
# Transition behavior: warn (and continue) when no expected hash is found,
# UNLESS GORDON_REQUIRE_BINARY_CHECKSUM is set; hard-fail on mismatch.
verify_checksum() {
    file="$1"
    asset="$2"
    version="$3"

    actual=$(sha256_of "$file") || {
        if [ -n "${GORDON_REQUIRE_BINARY_CHECKSUM:-}" ]; then
            error "No sha256sum/shasum tool available and GORDON_REQUIRE_BINARY_CHECKSUM is set."
        fi
        warn "No sha256sum/shasum tool found — skipping integrity verification."
        return 0
    }

    sums_url="https://raw.githubusercontent.com/${REPO}/v${version}/SHA256SUMS"
    sums_file="${TMP_DIR}/SHA256SUMS"
    expected=""
    if download "$sums_url" "$sums_file" 2>/dev/null; then
        expected=$(grep -E "[[:space:]]+${asset}\$" "$sums_file" 2>/dev/null | awk '{print $1}' | head -n 1)
    fi

    if [ -z "$expected" ]; then
        if [ -n "${GORDON_REQUIRE_BINARY_CHECKSUM:-}" ]; then
            error "No committed checksum for ${asset} (v${version}) and GORDON_REQUIRE_BINARY_CHECKSUM is set. Refusing to install."
        fi
        warn "Binary integrity could NOT be verified for ${asset} (v${version})."
        warn "No expected checksum was found in SHA256SUMS. sha256=${actual}"
        warn "Set GORDON_REQUIRE_BINARY_CHECKSUM=1 to fail closed instead."
        return 0
    fi

    if [ "$actual" != "$expected" ]; then
        rm -f "$file"
        error "Checksum mismatch for ${asset}: expected ${expected}, got ${actual}. Refusing to install a binary that does not match the committed checksum."
    fi

    info "Verified ${asset} checksum (sha256=${actual})."
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
    LIBC=$(detect_libc)
    if [ -n "$LIBC" ]; then
        info "Detected platform: ${OS}-${ARCH}-${LIBC}"
    else
        info "Detected platform: ${OS}-${ARCH}"
    fi

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

    # Construct download URL — append -musl suffix for Alpine/musl Linux
    if [ -n "$LIBC" ]; then
        ASSET_NAME="${BINARY_NAME}-${OS}-${ARCH}-${LIBC}"
    else
        ASSET_NAME="${BINARY_NAME}-${OS}-${ARCH}"
    fi
    DOWNLOAD_URL="https://github.com/${REPO}/releases/download/v${VERSION}/${ASSET_NAME}"
    info "Downloading from: ${DOWNLOAD_URL}"

    # Create temporary directory
    TMP_DIR=$(mktemp -d)
    trap 'rm -rf "$TMP_DIR"' EXIT

    TMP_FILE="${TMP_DIR}/${BINARY_NAME}"

    # Download binary
    if ! download "$DOWNLOAD_URL" "$TMP_FILE"; then
        error "Failed to download Gordon CLI. Please check if the version and platform are correct."
    fi

    # Verify SHA-256 integrity before making the binary executable.
    # Expected hashes come from the committed SHA256SUMS published with the
    # release. Fetched from the dist repo raw tree, keyed by asset filename.
    verify_checksum "$TMP_FILE" "$ASSET_NAME" "$VERSION"

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
        echo "        irm https://raw.githubusercontent.com/general-liquidity/gordon-dist/main/install.ps1 | iex"
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
