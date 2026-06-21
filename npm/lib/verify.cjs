const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CHECKSUMS_PATH = path.join(__dirname, "..", "checksums.json");

function isTruthyEnv(value) {
  if (!value) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized !== "" && normalized !== "0" && normalized !== "false" && normalized !== "no";
}

function sha256OfFile(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function readChecksums() {
  try {
    return JSON.parse(fs.readFileSync(CHECKSUMS_PATH, "utf8"));
  } catch {
    return {};
  }
}

function lookupExpectedHash(version, assetName) {
  const manifest = readChecksums();
  const cleanVersion = String(version).replace(/^v/, "");
  const forVersion = manifest[cleanVersion] || manifest[`v${cleanVersion}`];
  if (!forVersion || typeof forVersion !== "object") {
    return null;
  }
  const expected = forVersion[assetName];
  return typeof expected === "string" && expected.length > 0 ? expected.toLowerCase() : null;
}

/**
 * Verify a freshly-downloaded native binary against the committed checksum
 * manifest BEFORE it is made executable / placed on PATH.
 *
 * - hash present + matches  -> returns { verified: true }
 * - hash present + mismatch -> throws (caller deletes temp file + aborts)
 * - no entry for this version/asset -> warns and continues, UNLESS
 *   GORDON_REQUIRE_BINARY_CHECKSUM is set/truthy, in which case it throws.
 */
function verifyBinaryIntegrity({ tempPath, version, assetName }) {
  const expected = lookupExpectedHash(version, assetName);
  const actual = sha256OfFile(tempPath);

  if (expected) {
    if (actual.toLowerCase() !== expected) {
      throw new Error(
        `Checksum mismatch for ${assetName} (v${String(version).replace(/^v/, "")}): ` +
          `expected ${expected}, got ${actual}. Refusing to install a binary that ` +
          `does not match the committed checksum — this may indicate a compromised release channel.`
      );
    }
    return { verified: true, actual, expected };
  }

  if (isTruthyEnv(process.env.GORDON_REQUIRE_BINARY_CHECKSUM)) {
    throw new Error(
      `No committed checksum found for ${assetName} (v${String(version).replace(/^v/, "")}) ` +
        `and GORDON_REQUIRE_BINARY_CHECKSUM is set. Refusing to install an unverifiable binary.`
    );
  }

  process.stderr.write(
    "\n" +
      "============================================================\n" +
      " WARNING: Gordon binary integrity could NOT be verified.\n" +
      "------------------------------------------------------------\n" +
      ` asset:   ${assetName}\n` +
      ` version: ${String(version).replace(/^v/, "")}\n` +
      ` sha256:  ${actual}\n` +
      "\n" +
      " No expected checksum is committed for this version/asset in\n" +
      " npm/checksums.json. The downloaded native binary is being\n" +
      " installed WITHOUT integrity verification.\n" +
      "\n" +
      " Set GORDON_REQUIRE_BINARY_CHECKSUM=1 to fail closed instead.\n" +
      "============================================================\n\n"
  );

  return { verified: false, actual, expected: null };
}

/**
 * Best-effort, non-fatal minisign signature check. Only runs when a public
 * key (npm/minisign.pub) is configured AND a .minisig signature was
 * downloaded alongside the binary AND a `minisign`/`signify` tool is on PATH.
 * If anything is unconfigured/absent, this is a no-op.
 */
function verifySignatureIfPresent({ tempPath, sigPath, pubKeyPath }) {
  const resolvedPubKey = pubKeyPath || path.join(__dirname, "..", "minisign.pub");

  if (!sigPath || !fs.existsSync(sigPath) || !fs.existsSync(resolvedPubKey)) {
    return { verified: false, reason: "unconfigured" };
  }

  const { execFileSync } = require("child_process");

  const tryTool = (tool, args) => {
    try {
      execFileSync(tool, args, { stdio: ["ignore", "pipe", "pipe"] });
      return true;
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return null; // tool not present — try the next one
      }
      throw new Error(`Signature verification failed (${tool}): ${error.message}`);
    }
  };

  // minisign -Vm <file> -p <pubkey> -x <sig>
  const minisignResult = tryTool("minisign", ["-Vm", tempPath, "-p", resolvedPubKey, "-x", sigPath]);
  if (minisignResult === true) {
    return { verified: true, tool: "minisign" };
  }

  // signify-openbsd / signify -V -p <pubkey> -x <sig> -m <file>
  for (const tool of ["signify", "signify-openbsd"]) {
    const signifyResult = tryTool(tool, ["-V", "-p", resolvedPubKey, "-x", sigPath, "-m", tempPath]);
    if (signifyResult === true) {
      return { verified: true, tool };
    }
  }

  return { verified: false, reason: "no-tool" };
}

module.exports = {
  sha256OfFile,
  verifyBinaryIntegrity,
  verifySignatureIfPresent
};
