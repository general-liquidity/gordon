# Homebrew formula for Gordon CLI
# The Frontier Trading Agent
#
# Install: brew tap general-liquidity/tap && brew install gordon
# SHA256 hashes are updated automatically by CI on each release.

class Gordon < Formula
  desc "The Frontier Trading Agent - AI-powered crypto trading CLI"
  homepage "https://github.com/general-liquidity/gordon-cli"
  version "0.1.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/general-liquidity/gordon-cli/releases/download/v#{version}/gordon-darwin-arm64"
      sha256 "PLACEHOLDER_DARWIN_ARM64"
    else
      url "https://github.com/general-liquidity/gordon-cli/releases/download/v#{version}/gordon-darwin-x64"
      sha256 "PLACEHOLDER_DARWIN_X64"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/general-liquidity/gordon-cli/releases/download/v#{version}/gordon-linux-arm64"
      sha256 "PLACEHOLDER_LINUX_ARM64"
    else
      url "https://github.com/general-liquidity/gordon-cli/releases/download/v#{version}/gordon-linux-x64"
      sha256 "PLACEHOLDER_LINUX_X64"
    end
  end

  def install
    binary = Dir["gordon-*"].first || "gordon"
    bin.install binary => "gordon"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/gordon --version", 2)
  end
end
