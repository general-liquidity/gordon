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
  version "0.3.2"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/general-liquidity/gordon/releases/download/v#{version}/gordon-darwin-arm64"
      sha256 "927daee2d6be6b3948ceaf15635aaa570779d545f8781e51a78b4aa24a7bfc1a"
    else
      url "https://github.com/general-liquidity/gordon/releases/download/v#{version}/gordon-darwin-x64"
      sha256 "e1b87ce9a006722e3d7285db621cb43b323ec3a30b754d4e35accbc8da43e4aa"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/general-liquidity/gordon/releases/download/v#{version}/gordon-linux-arm64"
      sha256 "b164f6fd5610775acd79ad27278022d349fc5781cd0821de8cac13e846855227"
    else
      url "https://github.com/general-liquidity/gordon/releases/download/v#{version}/gordon-linux-x64"
      sha256 "2d2745a5e0092900f7aa5872345830c7ab16639d9814e0eb8904f48d2810862c"
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
