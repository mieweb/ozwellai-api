#!/usr/bin/env bash
# Build only the @mieweb/ui artifacts the embedded widget needs: the main
# `index` entry (JS + type declarations) plus the widget's CSS.
#
# The package's own `pnpm run build` also builds heavy, opt-in entries
# (esheet, datavis, globe, ag-grid, kerebron). Their rollup-dts type inlining
# needs well over a GitHub runner's 16 GB and OOMs the dts worker
# (ERR_WORKER_OUT_OF_MEMORY). The widget only imports `@mieweb/ui`,
# `@mieweb/ui/styles.css` and `@mieweb/ui/brands/ozwell.css`, so building just
# the index entry keeps the build under ~2 GB. Skipping the full build skips its
# `prebuild` (the memory-heavy `build:esheet`). Note the package's `prepare`
# hook still runs `build:datavis` and the CSS steps during `pnpm install`; the
# index entry does not use DataVis, but that build is unavoidable on install.
#
# Run from anywhere; safe to run repeatedly.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UI_DIR="$SCRIPT_DIR/../../vendor/mieweb-ui"
cd "$UI_DIR"

corepack pnpm install --frozen-lockfile

# Index entry JS only. Positional entry overrides the config's full entry map
# while keeping its plugins/options.
node --max-old-space-size=4096 ./node_modules/tsup/dist/cli-default.js src/index.ts

# Since 0.10.0 the config emits declarations only in batches selected by
# MIEWEB_DTS_ENTRIES (see its scripts/build-dts.mjs); build just the index batch.
MIEWEB_DTS_ENTRIES=index node --max-old-space-size=4096 ./node_modules/tsup/dist/cli-default.js

# CSS the widget loads, mirroring the package's own build/copy steps.
corepack pnpm run build:css
corepack pnpm run copy:brand-css
corepack pnpm run copy:style-css
corepack pnpm run copy:markdown-css
corepack pnpm run copy:kerebron-css
