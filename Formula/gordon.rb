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
  version "0.6.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/general-liquidity/gordon/releases/download/v#{version}/gordon-darwin-arm64"
      sha256 "4e518dbb45a74166148574128828ccfecab6357fc04747a3f6dbb0260816ac8a"
    else
      url "https://github.com/general-liquidity/gordon/releases/download/v#{version}/gordon-darwin-x64"
      sha256 "47183931d8d0f21845f7bf1b108d5b8ec67a679c29c341757c87f33aa410e5aa"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/general-liquidity/gordon/releases/download/v#{version}/gordon-linux-arm64"
      sha256 "e2e62ab8176a2b21aaa66c2680b6a8c3af82afb10c38074f7755f92baae8f8da"
    else
      url "https://github.com/general-liquidity/gordon/releases/download/v#{version}/gordon-linux-x64"
      sha256 "8f0c03b3f569c33d370760efc0fed72795797ec74e343e4d5e68f783b5981f3d"
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
