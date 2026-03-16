/**
 * Bundle the compiled server (dist/index.js) into a single CJS file
 * using esbuild. Native modules (better-sqlite3) are externalized and
 * their runtime files are copied alongside the bundle.
 */
const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const SERVER_DIST = path.join(PROJECT_ROOT, "dist");
const OUT_DIR = path.join(__dirname, "..", "dist", "server");
const BUNDLE_FILE = path.join(OUT_DIR, "bundle.cjs");

// Native modules that cannot be bundled
const EXTERNALS = ["better-sqlite3"];

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
    external: EXTERNALS,
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
    // Don't attempt to resolve .node binaries
    loader: { ".node": "empty" },
  });

  console.log(`[bundle-server] Bundle written to ${BUNDLE_FILE}`);

  // 2. Copy native module runtime files
  // Named "deps" instead of "node_modules" because electron-builder filters out node_modules
  const depsDst = path.join(OUT_DIR, "deps");
  for (const mod of EXTERNALS) {
    copyNativeModule(mod, depsDst);
  }

  // Also copy transitive runtime deps of better-sqlite3
  copyNativeModule("bindings", depsDst);
  copyNativeModule("file-uri-to-path", depsDst);

  // 3. Bundle user config files so the exe works out of the box
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

/**
 * Recursively copy a package from the project's node_modules
 * to the target node_modules directory.
 */
function copyNativeModule(modName, destNodeModules) {
  const src = path.join(PROJECT_ROOT, "node_modules", modName);
  const dst = path.join(destNodeModules, modName);

  if (!fs.existsSync(src)) {
    console.warn(`[bundle-server] WARNING: ${modName} not found at ${src}`);
    return;
  }

  console.log(`[bundle-server] Copying ${modName}...`);
  copyDirSync(src, dst);
}

function copyDirSync(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      // Skip test/docs/src dirs to reduce size
      if (["test", "docs", "src", ".github", "benchmark"].includes(entry.name)) continue;
      copyDirSync(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

main().catch((err) => {
  console.error("[bundle-server] FAILED:", err);
  process.exit(1);
});
