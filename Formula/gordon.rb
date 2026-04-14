# Homebrew formula for Gordon CLI
# The Frontier Trading Agent
#
# Install:
#   brew tap general-liquidity/gordon-cli-dist https://github.com/general-liquidity/gordon-cli-dist
#   brew install general-liquidity/gordon-cli-dist/gordon
# SHA256 hashes are updated automatically by CI on each release.

class Gordon < Formula
  desc "The Frontier Trading Agent - AI-powered crypto trading CLI"
  homepage "https://gordoncli.com"
  version "0.9.0-friends.5"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/general-liquidity/gordon-cli-dist/releases/download/v#{version}/gordon-darwin-arm64"
      sha256 "e3db4d8668967cf01cc9ac26936f010210b090b0fbd6590e7b6ce07b72c9cddb"
    else
      url "https://github.com/general-liquidity/gordon-cli-dist/releases/download/v#{version}/gordon-darwin-x64"
      sha256 "5919dea7824708267e4c01cb7f19201594d427a7c04bfdf67bdb6644df4c3e6f_DARWIN_X64"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/general-liquidity/gordon-cli-dist/releases/download/v#{version}/gordon-linux-arm64"
      sha256 "e3579f7b089e66937685e2222322f0786baf67d9ec066c2a99da122c53221430_LINUX_ARM64"
    else
      url "https://github.com/general-liquidity/gordon-cli-dist/releases/download/v#{version}/gordon-linux-x64"
      sha256 "b562be53fc040bd9f76f04daa0d505d85bab0eb3a7c663618da2e58ba21d5266_LINUX_X64"
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
