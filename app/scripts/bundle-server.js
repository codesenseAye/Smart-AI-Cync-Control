/**
 * Bundle the compiled server (dist/index.js) into a single CJS file
 * using esbuild.
 */
const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const SERVER_DIST = path.join(PROJECT_ROOT, "dist");
const OUT_DIR = path.join(__dirname, "..", "dist", "server");
const BUNDLE_FILE = path.join(OUT_DIR, "bundle.cjs");

async function main() {
  console.log("[bundle-server] Bundling server...");

  // 1. esbuild bundle
  await esbuild.build({
    entryPoints: [path.join(SERVER_DIST, "index.js")],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "cjs",
    outfile: BUNDLE_FILE,
    // Silence warnings about __dirname in ESM (we're converting to CJS)
    define: {
      "import.meta.url": "__import_meta_url",
    },
    banner: {
      js: [
        "// Shim import.meta.url for CJS bundle",
        'const __import_meta_url = require("url").pathToFileURL(__filename).href;',
      ].join("\n"),
    },
    sourcemap: false,
    minify: false,
  });

  console.log(`[bundle-server] Bundle written to ${BUNDLE_FILE}`);

  // 2. Bundle user config files so the exe works out of the box
  const configDir = path.join(OUT_DIR, "defaults");
  fs.mkdirSync(configDir, { recursive: true });

  const envFile = path.join(PROJECT_ROOT, ".env");
  if (fs.existsSync(envFile)) {
    fs.copyFileSync(envFile, path.join(configDir, "config.env"));
    console.log("[bundle-server] Bundled .env as defaults/config.env");
  } else {
    console.warn("[bundle-server] WARNING: .env not found — exe will use template config");
  }

  const roomsFile = path.join(PROJECT_ROOT, "src", "data", "rooms.json");
  if (fs.existsSync(roomsFile)) {
    fs.copyFileSync(roomsFile, path.join(configDir, "rooms.json"));
    console.log("[bundle-server] Bundled rooms.json as defaults/rooms.json");
  } else {
    console.warn("[bundle-server] WARNING: rooms.json not found — exe will use template config");
  }

  console.log("[bundle-server] Done.");
}

main().catch((err) => {
  console.error("[bundle-server] FAILED:", err);
  process.exit(1);
});
