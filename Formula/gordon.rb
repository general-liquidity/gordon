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
  version "0.5.5"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/general-liquidity/gordon/releases/download/v#{version}/gordon-darwin-arm64"
      sha256 "54cbd18d207eb1327880284e01b6b357c18c07abbcd59f0715dba96a8238006d"
    else
      url "https://github.com/general-liquidity/gordon/releases/download/v#{version}/gordon-darwin-x64"
      sha256 "14bcce82013c2c3328efc8be500e14ce1645194fc3bcbf3acaf866c0c4720556"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/general-liquidity/gordon/releases/download/v#{version}/gordon-linux-arm64"
      sha256 "c7b2518e0b42b939b0a9db2c067f84a1560500f0c8e3f539a77cc985eb3c73b6"
    else
      url "https://github.com/general-liquidity/gordon/releases/download/v#{version}/gordon-linux-x64"
      sha256 "e5e8163c4086736128a65eb903b2c94cac5feb3fddb744c5285e3ce344b87813"
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
