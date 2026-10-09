import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    // lib/yield-convention.test.ts replays the whole engine once per candidate
    // convention, so a handful of its cases legitimately run for seconds — the
    // holdout selection takes about 25. The default 5s failed one of them and
    // left `npm test` red for a reason that has nothing to do with the code
    // under test. Raise the ceiling instead of trimming the search: the whole
    // point of those tests is that they are exhaustive.
    testTimeout: 120_000,
  },
});
