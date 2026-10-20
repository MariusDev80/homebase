import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/app/data/**/*.spec.ts'],
    env: {
      HOMEBASE_MIGRATIONS_DIR: fileURLToPath(
        new URL('../desktop/src-tauri/migrations', import.meta.url),
      ),
    },
  },
});
