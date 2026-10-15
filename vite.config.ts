/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// The node builtins have no types here (no @types/node), like `process` below.
// @ts-expect-error node builtin
import { realpathSync } from "node:fs";
// @ts-expect-error node builtin
import path from "node:path";
// @ts-expect-error node builtin
import { fileURLToPath } from "node:url";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// The project root's own `.claude/` folder, which holds git worktrees, as an
// absolute path. It is anchored to this config's directory instead of written as
// `**/.claude/**`, because a worktree lives at `<repo>/.claude/worktrees/<name>`:
// the `**` pattern also matches the worktree's own path and silently turns off
// hot reload for every file when the dev server runs from a worktree. Both the
// path as given and its realpath are checked, since the repo is reachable
// through a symlink.
const configDir = path.dirname(fileURLToPath(import.meta.url));
const ownClaudeDirs: string[] = [configDir, realpathSync(configDir)].map(
  (dir: string) => path.join(dir, ".claude"),
);
const isUnderOwnClaudeDir = (file: string) =>
  ownClaudeDirs.some(
    (dir) => file === dir || file.indexOf(dir + path.sep) === 0,
  );

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    typecheck: { tsconfig: './tsconfig.test.json' },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: true, 
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      //
      // .claude/ holds git worktrees, which live inside the repo root and so
      // get walked by the watcher. A flatpak build run from one leaves a
      // build-dir containing an entire app filesystem -- including
      // var/run/udev/watch symlinks that loop -- which kills the dev server
      // on startup with `ELOOP: too many symbolic links encountered`.
      ignored: ["**/src-tauri/**", isUnderOwnClaudeDir],
    },
  },
}));
