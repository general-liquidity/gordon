const fs = require("fs");
const path = require("path");

const rootDirectory = path.resolve(__dirname, "..", "..");
const outputFlagIndex = process.argv.indexOf("--out-dir");

if (outputFlagIndex < 0 || !process.argv[outputFlagIndex + 1]) {
  throw new Error('Usage: node scripts/build/prepare-public-dist.cjs --out-dir <directory>');
}

const outputDirectory = path.resolve(process.argv[outputFlagIndex + 1]);

function ensureDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function copyFile(sourceRelativePath, targetRelativePath) {
  const sourcePath = path.join(rootDirectory, sourceRelativePath);
  const targetPath = path.join(outputDirectory, targetRelativePath);
  ensureDirectory(targetPath);
  fs.copyFileSync(sourcePath, targetPath);
}

function writeReadme() {
  const sourceReadme = path.join(rootDirectory, "npm", "README.md");
  const targetReadme = path.join(outputDirectory, "README.md");
  ensureDirectory(targetReadme);
  fs.copyFileSync(sourceReadme, targetReadme);
}

fs.mkdirSync(outputDirectory, { recursive: true });

writeReadme();
copyFile("LICENSE", "LICENSE");
copyFile("scripts/install.sh", "install.sh");
copyFile("scripts/install.ps1", "install.ps1");
copyFile("Formula/gordon.rb", "Formula/gordon.rb");
copyFile("scripts/scoop/gordon.json", "bucket/gordon.json");

console.log(`Prepared public dist repo in ${outputDirectory}.`);
