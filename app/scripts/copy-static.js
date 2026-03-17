// Copy static assets (HTML) from src/renderer to dist/renderer
// CSS is bundled by esbuild via build-renderer.js
const fs = require("fs");
const path = require("path");

const srcDir = path.join(__dirname, "..", "src", "renderer");
const destDir = path.join(__dirname, "..", "dist", "renderer");

fs.mkdirSync(destDir, { recursive: true });

for (const file of fs.readdirSync(srcDir)) {
  if (file.endsWith(".html")) {
    fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
    console.log(`Copied ${file}`);
  }
}
