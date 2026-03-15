const fs = require("fs");
const path = require("path");

const rootDirectory = path.resolve(__dirname, "..");
const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDirectory, "package.json"), "utf8"));
const wrapperDirectory = path.join(rootDirectory, "npm");
const wrapperPkg = JSON.parse(fs.readFileSync(path.join(wrapperDirectory, "package.json"), "utf8"));
const expectedVersion = String(process.env.GORDON_NPM_VERSION || rootPkg.version).replace(/^v/, "");

const errors = [];

if (wrapperPkg.name !== "@general-liquidity/gordon-cli") {
  errors.push(`Wrapper package name must stay scoped, found "${wrapperPkg.name}".`);
}

if (wrapperPkg.version !== expectedVersion) {
  errors.push(`Wrapper package version is "${wrapperPkg.version}", expected "${expectedVersion}".`);
}

if (Object.keys(wrapperPkg.dependencies || {}).length > 0) {
  errors.push("Wrapper package must not have runtime dependencies.");
}

if (Object.keys(wrapperPkg.optionalDependencies || {}).length > 0) {
  errors.push("Wrapper package must not have optional dependencies.");
}

if ((wrapperPkg.bin || {}).gordon !== "bin/gordon.cjs") {
  errors.push('Wrapper package bin.gordon must point to "bin/gordon.cjs".');
}

if ((wrapperPkg.scripts || {}).postinstall !== "node scripts/postinstall.cjs") {
  errors.push('Wrapper package postinstall must run "node scripts/postinstall.cjs".');
}

if ((wrapperPkg.repository || {}).url !== "https://github.com/general-liquidity/gordon-cli-dist.git") {
  errors.push('Wrapper package repository.url must point to "https://github.com/general-liquidity/gordon-cli-dist.git".');
}

if (wrapperPkg.homepage !== "https://gordoncli.com") {
  errors.push('Wrapper package homepage must point to "https://gordoncli.com".');
}

if (wrapperPkg.bugs !== "https://github.com/general-liquidity/gordon-cli-dist/issues") {
  errors.push('Wrapper package bugs must point to "https://github.com/general-liquidity/gordon-cli-dist/issues".');
}

for (const relativePath of [
  "bin/gordon.cjs",
  "lib/platform.cjs",
  "lib/self-install.cjs",
  "scripts/postinstall.cjs",
  "README.md",
  "LICENSE"
]) {
  if (!fs.existsSync(path.join(wrapperDirectory, relativePath))) {
    errors.push(`Wrapper package is missing ${relativePath}.`);
  }
}

if (errors.length > 0) {
  console.error("npm wrapper checks failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("npm wrapper checks passed.");
