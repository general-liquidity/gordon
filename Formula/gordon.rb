# Homebrew formula for Gordon CLI
# The Frontier Trading Agent
#
# Install:
#   brew tap general-liquidity/gordon https://github.com/general-liquidity/gordon
#   brew install general-liquidity/gordon/gordon
# SHA256 hashes are updated automatically by CI on each release.

class Gordon < Formula
  desc "The Frontier Trading Agent - AI-powered crypto trading CLI"
  homepage "https://gordoncli.com"
  version "0.1.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/general-liquidity/gordon/releases/download/v#{version}/gordon-darwin-arm64"
      sha256 "0000000000000000000000000000000000000000000000000000000000000000"
    else
      url "https://github.com/general-liquidity/gordon/releases/download/v#{version}/gordon-darwin-x64"
      sha256 "0000000000000000000000000000000000000000000000000000000000000000"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/general-liquidity/gordon/releases/download/v#{version}/gordon-linux-arm64"
      sha256 "0000000000000000000000000000000000000000000000000000000000000000"
    else
      url "https://github.com/general-liquidity/gordon/releases/download/v#{version}/gordon-linux-x64"
      sha256 "0000000000000000000000000000000000000000000000000000000000000000"
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
