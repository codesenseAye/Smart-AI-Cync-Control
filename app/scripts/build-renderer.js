const esbuild = require("esbuild");
const path = require("path");

esbuild.buildSync({
  entryPoints: [path.join(__dirname, "..", "src", "renderer", "index.tsx")],
  bundle: true,
  outfile: path.join(__dirname, "..", "dist", "renderer", "renderer.js"),
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  loader: { ".css": "css" },
  sourcemap: true,
  define: { "process.env.NODE_ENV": '"production"' },
});

console.log("Renderer bundled");
