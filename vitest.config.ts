import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Copies of src/ that must not be collected:
    //  - the standalone build (output: 'standalone') traces one into
    //    .next/standalone, so every test would run twice;
    //  - agent worktrees under .claude/worktrees/ are separate checkouts with
    //    their own node_modules. Collecting them mixes two React copies (the
    //    `@` alias still resolves to THIS tree) and reports failures that
    //    belong to a different commit.
    exclude: ['**/node_modules/**', '**/.next/**', '**/.claude/worktrees/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
