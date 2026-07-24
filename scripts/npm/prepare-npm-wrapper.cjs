const fs = require("fs");
const path = require("path");

const rootDirectory = path.resolve(__dirname, "..", "..");
const rootPackagePath = path.join(rootDirectory, "package.json");
const wrapperDirectory = path.join(rootDirectory, "npm");
const wrapperPackagePath = path.join(wrapperDirectory, "package.json");
const filesToCopy = ["LICENSE"];
const WRAPPER_REPOSITORY_URL = "https://github.com/general-liquidity/gordon.git";
const WRAPPER_HOMEPAGE = "https://gordoncli.com";
const WRAPPER_BUGS_URL = "https://github.com/general-liquidity/gordon/issues";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeFileIfChanged(filePath, nextContent) {
  const currentContent = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
  if (currentContent === nextContent) {
    return false;
  }

  fs.writeFileSync(filePath, nextContent, "utf8");
  return true;
}

function getRequestedVersion(defaultVersion) {
  const versionFlag = process.argv.indexOf("--version");
  const argValue =
    versionFlag >= 0 && process.argv[versionFlag + 1] ? process.argv[versionFlag + 1] : undefined;
  return String(argValue || process.env.GORDON_NPM_VERSION || defaultVersion).replace(/^v/, "");
}

const rootPkg = readJson(rootPackagePath);
const wrapperPkg = readJson(wrapperPackagePath);
const version = getRequestedVersion(rootPkg.version);

wrapperPkg.version = version;
wrapperPkg.author = rootPkg.author;
wrapperPkg.bugs = WRAPPER_BUGS_URL;
wrapperPkg.description = rootPkg.description;
wrapperPkg.homepage = WRAPPER_HOMEPAGE;
wrapperPkg.keywords = rootPkg.keywords;
wrapperPkg.license = rootPkg.license;
wrapperPkg.repository = {
  type: "git",
  url: WRAPPER_REPOSITORY_URL
};

const packageChanged = writeFileIfChanged(
  wrapperPackagePath,
  `${JSON.stringify(wrapperPkg, null, 2)}\n`
);

let copiedFiles = 0;
for (const fileName of filesToCopy) {
  const sourcePath = path.join(rootDirectory, fileName);
  const targetPath = path.join(wrapperDirectory, fileName);
  const content = fs.readFileSync(sourcePath, "utf8");
  if (writeFileIfChanged(targetPath, content)) {
    copiedFiles += 1;
  }
}

const changedParts = [];
if (packageChanged) {
  changedParts.push("package.json");
}
if (copiedFiles > 0) {
  changedParts.push(`${copiedFiles} asset file(s)`);
}

console.log(
  changedParts.length > 0
    ? `Prepared npm wrapper (${changedParts.join(", ")}).`
    : "npm wrapper is up to date."
);
