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
  version "0.6.1"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/general-liquidity/gordon/releases/download/v#{version}/gordon-darwin-arm64"
      sha256 "8bd7d09e5d5c7a33b5ac4bc6e954868862e71f915821bd4fb306dc238911039b"
    else
      url "https://github.com/general-liquidity/gordon/releases/download/v#{version}/gordon-darwin-x64"
      sha256 "9cfa3a3f88c18f07ad82f1a80888e519b7c647a191e5d526ea5324846f20f785"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/general-liquidity/gordon/releases/download/v#{version}/gordon-linux-arm64"
      sha256 "6d72c0f9f49e9467520c28a3c88b5e211b17bc3f4129a4efd5ba755c96fe71b6"
    else
      url "https://github.com/general-liquidity/gordon/releases/download/v#{version}/gordon-linux-x64"
      sha256 "69445cf39a917b71e69725103982d4ad4e2e5f10cbcf3e069fd904e7a2da09eb"
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
