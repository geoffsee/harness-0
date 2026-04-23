#!/usr/bin/env bun
import { rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";

const DIST = "./dist";
const PUBLIC = "./public";

async function copyDir(src: string, dest: string) {
    await mkdir(dest, { recursive: true });

    for await (const entry of new Bun.Glob("**/*").scan({ cwd: src, absolute: false })) {
        const from = join(src, entry);
        const to = join(dest, entry);
        const file = Bun.file(from);

        if ((await file.stat()).isDirectory()) {
            await mkdir(to, { recursive: true });
            continue;
        }

        await mkdir(join(to, ".."), { recursive: true });
        await Bun.write(to, file);
    }
}

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

const result = await Bun.build({
    entrypoints: ["./src/index.tsx"],
    outdir: DIST,
    target: "browser",
    format: "esm",
    splitting: true,
    sourcemap: "external",
    minify: true,
    naming: {
        entry: "[dir]/[name]-[hash].[ext]",
        chunk: "chunks/[name]-[hash].[ext]",
        asset: "assets/[name]-[hash].[ext]",
    },
    define: {
        "process.env.NODE_ENV": JSON.stringify("production"),
    },
    publicPath: "./",
    throw: false,
});

if (!result.success) {
    console.error("Build failed:");
    for (const log of result.logs) {
        console.error(log);
    }
    process.exit(1);
}

if (existsSync(PUBLIC)) {
    await copyDir(PUBLIC, DIST);
}

const entryScript = result.outputs
    .map((output) => basename(output.path))
    .find((path) => path.includes("index-") && path.endsWith(".js"));

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="data:," />
    <title>Secure Mesh Network</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f5f0e8;
        --panel: rgba(255, 252, 246, 0.9);
        --ink: #17313e;
        --accent: #0f766e;
        --accent-soft: rgba(15, 118, 110, 0.12);
        --warn: #9a3412;
        --border: rgba(23, 49, 62, 0.16);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Avenir Next", sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(15, 118, 110, 0.25), transparent 32%),
          radial-gradient(circle at bottom right, rgba(180, 83, 9, 0.18), transparent 28%),
          var(--bg);
      }
      #app {
        max-width: 1100px;
        margin: 0 auto;
        padding: 32px 20px 64px;
      }
      .shell {
        display: grid;
        gap: 18px;
      }
      .hero, .panel {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 18px;
        backdrop-filter: blur(10px);
        box-shadow: 0 18px 60px rgba(23, 49, 62, 0.08);
      }
      .hero { padding: 24px; }
      .hero h1 { margin: 0 0 10px; font-size: clamp(2rem, 5vw, 3.6rem); line-height: 0.95; }
      .hero p { margin: 0; max-width: 60ch; }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 18px;
      }
      .panel { padding: 18px; }
      h2 { margin: 0 0 12px; font-size: 1rem; text-transform: uppercase; letter-spacing: 0.08em; }
      .statline { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
      .chip {
        padding: 6px 10px;
        border-radius: 999px;
        background: var(--accent-soft);
        color: var(--accent);
        font-size: 0.9rem;
      }
      ul { margin: 0; padding-left: 18px; }
      li + li { margin-top: 8px; }
      code {
        font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
        font-size: 0.92em;
      }
      .warn { color: var(--warn); }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./${entryScript}"></script>
  </body>
</html>`;

await Bun.write(join(DIST, "index.html"), html);
await Bun.write(join(DIST, ".nojekyll"), "");

console.log("Built browser dist in ./dist");
