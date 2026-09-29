// Give tsup's dts worker an explicit heap so the pinned mieweb-ui build does not
// OOM on CI runners.
//
// tsup generates .d.ts for every entry point inside a single worker_threads
// worker that it creates WITHOUT `resourceLimits`. Such workers use V8's default
// old-space limit, which scales with physical RAM — large enough locally but too
// small on GitHub-hosted runners, where the dts build dies with
// ERR_WORKER_OUT_OF_MEMORY. `--max-old-space-size` / NODE_OPTIONS do not affect
// worker threads, so the only reliable lever is the worker's resourceLimits.
//
// This rewrites the installed tsup so the dts worker gets a fixed 8 GB heap.
// Run it after `pnpm install` and before the build. Safe to run more than once.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HEAP_MB = Number(process.env.TSUP_DTS_HEAP_MB) || 8192;
const tsupIndex = resolve(process.argv[2] ?? 'vendor/mieweb-ui', 'node_modules/tsup/dist/index.js');

const NEEDLE = '"./rollup.js"))';
const REPLACEMENT = `"./rollup.js"), { resourceLimits: { maxOldGenerationSizeMb: ${HEAP_MB} } })`;

const source = readFileSync(tsupIndex, 'utf8');

if (source.includes('maxOldGenerationSizeMb')) {
  console.log(`[raise-tsup-dts-memory] already patched: ${tsupIndex}`);
  process.exit(0);
}

const occurrences = source.split(NEEDLE).length - 1;
if (occurrences !== 1) {
  throw new Error(
    `[raise-tsup-dts-memory] expected exactly one tsup dts Worker call in ${tsupIndex}, found ${occurrences}. ` +
    'The tsup internals changed — update NEEDLE for the pinned tsup version.'
  );
}

writeFileSync(tsupIndex, source.replace(NEEDLE, REPLACEMENT));
console.log(`[raise-tsup-dts-memory] set dts worker heap to ${HEAP_MB} MB in ${tsupIndex}`);
