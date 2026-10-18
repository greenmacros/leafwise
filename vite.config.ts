import { defineConfig } from 'vite';

// base './' lets the built site run from any sub-path or straight from static hosting.
export default defineConfig({
  base: './',
  test: { include: ['tests/**/*.test.ts'] },
});
