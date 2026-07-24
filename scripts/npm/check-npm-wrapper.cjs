const fs = require("fs");
const path = require("path");

const rootDirectory = path.resolve(__dirname, "..", "..");
const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDirectory, "package.json"), "utf8"));
const wrapperDirectory = path.join(rootDirectory, "npm");
const wrapperPkg = JSON.parse(fs.readFileSync(path.join(wrapperDirectory, "package.json"), "utf8"));
const expectedVersion = String(process.env.GORDON_NPM_VERSION || rootPkg.version).replace(/^v/, "");

// The per-platform binary sub-packages the wrapper depends on. Missing targets
// degrade gracefully at install time (optional), but every one must be listed
// here at the release version so the matching host actually gets a binary.
const EXPECTED_OPTIONAL_TARGETS = [
  "linux-x64",
  "linux-arm64",
  "linux-x64-musl",
  "linux-arm64-musl",
  "darwin-x64",
  "darwin-arm64",
  "win32-x64",
  "win32-arm64"
];

const errors = [];

if (wrapperPkg.name !== "@general-liquidity/gordon") {
  errors.push(`Wrapper package name must stay scoped, found "${wrapperPkg.name}".`);
}

if (wrapperPkg.version !== expectedVersion) {
  errors.push(`Wrapper package version is "${wrapperPkg.version}", expected "${expectedVersion}".`);
}

if (Object.keys(wrapperPkg.dependencies || {}).length > 0) {
  errors.push("Wrapper package must not have runtime dependencies.");
}

// Distribution is via optionalDependencies now — there must be no postinstall
// binary-download step (that was the 404/no-fallback/proxy failure class).
if ((wrapperPkg.scripts || {}).postinstall) {
  errors.push("Wrapper package must not declare a postinstall script (optionalDependencies model).");
}

if ((wrapperPkg.bin || {}).gordon !== "bin/gordon.cjs") {
  errors.push('Wrapper package bin.gordon must point to "bin/gordon.cjs".');
}

const files = wrapperPkg.files || [];
if (!(files.length === 1 && files[0] === "bin/gordon.cjs")) {
  errors.push(`Wrapper package files must be exactly ["bin/gordon.cjs"], found ${JSON.stringify(files)}.`);
}

const optionalDeps = wrapperPkg.optionalDependencies || {};
for (const target of EXPECTED_OPTIONAL_TARGETS) {
  const depName = `@general-liquidity/gordon-${target}`;
  if (!(depName in optionalDeps)) {
    errors.push(`Wrapper package is missing optionalDependency ${depName}.`);
  } else if (optionalDeps[depName] !== expectedVersion) {
    errors.push(
      `optionalDependency ${depName} is "${optionalDeps[depName]}", expected "${expectedVersion}".`
    );
  }
}
for (const depName of Object.keys(optionalDeps)) {
  const target = depName.replace("@general-liquidity/gordon-", "");
  if (!EXPECTED_OPTIONAL_TARGETS.includes(target)) {
    errors.push(`Unexpected optionalDependency ${depName}.`);
  }
}

if ((wrapperPkg.repository || {}).url !== "https://github.com/general-liquidity/gordon.git") {
  errors.push('Wrapper package repository.url must point to "https://github.com/general-liquidity/gordon.git".');
}

if (wrapperPkg.homepage !== "https://gordoncli.com") {
  errors.push('Wrapper package homepage must point to "https://gordoncli.com".');
}

if (wrapperPkg.bugs !== "https://github.com/general-liquidity/gordon/issues") {
  errors.push('Wrapper package bugs must point to "https://github.com/general-liquidity/gordon/issues".');
}

for (const relativePath of ["bin/gordon.cjs", "README.md", "LICENSE"]) {
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
