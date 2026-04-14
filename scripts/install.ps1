# Gordon CLI Installer for Windows
# Usage: irm https://raw.githubusercontent.com/general-liquidity/gordon-cli-dist/main/install.ps1 | iex
# Custom dir: $env:GORDON_INSTALL_DIR="$env:LOCALAPPDATA\\Programs\\Gordon"; irm https://raw.githubusercontent.com/general-liquidity/gordon-cli-dist/main/install.ps1 | iex

[CmdletBinding()]
param(
    [string]$InstallDir = $(if ($env:GORDON_INSTALL_DIR) { $env:GORDON_INSTALL_DIR } else { "" })
)

$ErrorActionPreference = "Stop"

$Repo = if ($env:GORDON_DIST_REPO) { $env:GORDON_DIST_REPO } else { "general-liquidity/gordon-cli-dist" }
$BinaryName = "gordon"

function Write-Info($msg) { Write-Host "info: $msg" -ForegroundColor Cyan }
function Write-Success($msg) { Write-Host "success: $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "warning: $msg" -ForegroundColor Yellow }
function Write-Err($msg) { Write-Host "error: $msg" -ForegroundColor Red; exit 1 }

# Detect architecture
function Get-Arch {
    $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
    switch ($arch) {
        "X64" { return "x64" }
        "Arm64" { return "arm64" }
        default { Write-Err "Unsupported architecture: $arch" }
    }
}

# Get latest version from GitHub
function Get-LatestVersion {
    try {
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ "User-Agent" = "gordon-installer" }
        return $release.tag_name -replace "^v", ""
    }
    catch {
        Write-Err "Failed to fetch latest version from GitHub: $_"
    }
}

function Main {
    Write-Host ""
    Write-Host "  Gordon CLI Installer" -ForegroundColor White
    Write-Host "  The Frontier Trading Agent" -ForegroundColor DarkGray
    Write-Host ""

    # Detect platform
    $Arch = Get-Arch
    Write-Info "Detected platform: windows-$Arch"

    # Get version
    if ($env:GORDON_VERSION) {
        $Version = $env:GORDON_VERSION
        Write-Info "Using specified version: v$Version"
    }
    else {
        Write-Info "Fetching latest version..."
        $Version = Get-LatestVersion
        Write-Info "Latest version: v$Version"
    }

    # Detect architecture so arm64 hosts (Surface Pro X, dev kits, Parallels
    # arm64 VMs) get a native binary instead of x64-on-emulation.
    $ArchEnum = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
    if ($ArchEnum -eq [System.Runtime.InteropServices.Architecture]::Arm64) {
        $FileName = "$BinaryName-windows-arm64.exe"
    } else {
        $FileName = "$BinaryName-windows-x64.exe"
    }
    $DownloadUrl = "https://github.com/$Repo/releases/download/v$Version/$FileName"
    Write-Info "Downloading from: $DownloadUrl"

    # Install directory
    if (-not $InstallDir) {
        $InstallDir = Join-Path $env:LOCALAPPDATA "gordon"
    }
    if (-not (Test-Path $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    }

    $InstallPath = Join-Path $InstallDir "$BinaryName.exe"
    $TempPath = Join-Path $env:TEMP "$FileName"

    # Download
    try {
        Invoke-WebRequest -Uri $DownloadUrl -OutFile $TempPath -UseBasicParsing
    }
    catch {
        Write-Err "Failed to download Gordon CLI. Check version and platform. Error: $_"
    }

    # Move to install location
    Move-Item -Path $TempPath -Destination $InstallPath -Force
    Write-Info "Installed to $InstallPath"

    $metadata = @{
        channel = "script-windows"
        installDir = $InstallDir
        version = $Version
    } | ConvertTo-Json
    Set-Content -Path (Join-Path $InstallDir "gordon-install.json") -Value $metadata

    # Add to PATH if needed
    $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($UserPath -notlike "*$InstallDir*") {
        $NewPath = "$UserPath;$InstallDir"
        [Environment]::SetEnvironmentVariable("Path", $NewPath, "User")
        Write-Info "Added $InstallDir to user PATH"
        Write-Warn "Restart your terminal for PATH changes to take effect"
    }

    # Verify
    if (Test-Path $InstallPath) {
        Write-Host ""
        Write-Success "Gordon CLI v$Version installed successfully!"
    }
    else {
        Write-Err "Installation failed: binary not found at $InstallPath"
    }

    Write-Host ""
    Write-Host "Get started:" -ForegroundColor White
    Write-Host ""
    Write-Host "    gordon --help     # Show available commands" -ForegroundColor Gray
    Write-Host "    gordon init       # Initialize Gordon in your project" -ForegroundColor Gray
    Write-Host "    gordon            # Start interactive mode" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Note: Open a new terminal window for the 'gordon' command to be available." -ForegroundColor Yellow
    Write-Host ""
}

Main
