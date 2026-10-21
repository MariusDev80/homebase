import { defineConfig } from 'vitest/config';

// Extra options for the Angular unit-test builder (angular.json, "runnerConfig").
// The builder defaults to isolate: false, so vi.mock() factories and module state leaked between
// spec files that ran in the same worker (intermittent failures in core/system specs).
export default defineConfig({
  test: { isolate: true },
});
