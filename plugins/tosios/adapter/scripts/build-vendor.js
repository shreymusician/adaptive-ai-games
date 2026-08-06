#!/usr/bin/env node
/**
 * Compiles the subset of vendored TOSIOS source this adapter needs
 * (packages/common, plus server entities/states/rooms) with TOSIOS's OWN
 * lenient compiler settings (tsconfig.vendor.json — modeled on upstream's
 * own root tsconfig.json, deliberately NOT this monorepo's strict
 * tsconfig.base.json) into `vendor-dist/`.
 *
 * Why this step exists at all: TOSIOS's package.json points `main` at raw
 * `.ts` source (an esbuild-bundling convention, never meant to be consumed
 * as a type-checked dependency by another package — see the Phase 10A
 * integration report's "Known friction points" section). Compiling it once,
 * here, with ITS OWN settings, and having the adapter's own strict `tsc -b`
 * consume the resulting `.d.ts`/`.js` (via `skipLibCheck`, already set in
 * this repo's tsconfig.base.json) is what lets the adapter stay under this
 * repo's strict settings WITHOUT modifying a single byte of `../upstream/`.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ADAPTER_DIR = path.resolve(__dirname, '..');
const VENDOR_DIST = path.join(ADAPTER_DIR, 'vendor-dist');

// 1. Compile with TOSIOS's own lenient settings.
execFileSync('npx', ['tsc', '-p', path.join(ADAPTER_DIR, 'tsconfig.vendor.json')], {
  stdio: 'inherit',
  cwd: ADAPTER_DIR,
  shell: process.platform === 'win32',
});

// 2. tsc does not emit non-.ts inputs — common/src/maps/index.ts does
//    `import gigantic from './gigantic.json'` (resolveJsonModule), which at
//    RUNTIME needs the physical .json file next to the compiled .js. Copy
//    the two map files across (byte-for-byte, from the unmodified vendor).
const mapsSrc = path.join(ADAPTER_DIR, '..', 'upstream', 'packages', 'common', 'src', 'maps');
const mapsDest = path.join(VENDOR_DIST, 'common', 'src', 'maps');
fs.mkdirSync(mapsDest, { recursive: true });
for (const file of ['gigantic.json', 'small.json']) {
  fs.copyFileSync(path.join(mapsSrc, file), path.join(mapsDest, file));
}

// 3. TypeScript's `paths` mapping is compile-time-only — it does NOT rewrite
//    the emitted `require('@tosios/common')` calls in the compiled .js, so
//    Node needs a REAL resolvable `@tosios/common` package at runtime. Write
//    a tiny package.json under vendor-dist/node_modules whose `main` points
//    (via a relative path) straight at the already-compiled common output —
//    no copying, no symlink (symlinks need elevated privileges on Windows).
const aliasDir = path.join(VENDOR_DIST, 'node_modules', '@tosios', 'common');
fs.mkdirSync(aliasDir, { recursive: true });
fs.writeFileSync(
  path.join(aliasDir, 'package.json'),
  JSON.stringify({ name: '@tosios/common', version: '0.1.0', main: '../../../common/src/index.js', types: '../../../common/src/index.d.ts' }, null, 2) + '\n'
);

console.log('[build-vendor] TOSIOS common+server compiled to vendor-dist/, @tosios/common alias wired for runtime resolution.');
