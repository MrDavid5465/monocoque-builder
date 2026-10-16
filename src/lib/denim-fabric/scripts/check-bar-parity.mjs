#!/usr/bin/env node
// Compares the full export lists (values AND types) of denim-fabric bar
// packages: each must export exactly denim-fabric's own exports plus
// `Shell` and `default` (shared/barContract.ts), so all bars match.
// Each bar's parity.check.ts already checks its values and their types on
// every `tsc`; this script also catches a type-only export added to one bar.
//
// Run it from an app that has the packages side by side and TypeScript
// installed (it uses the app's `typescript`):
//
//   node src/lib/denim-fabric/scripts/check-bar-parity.mjs \
//     src/lib/denim-fabric-topbar src/lib/denim-fabric-sidebar
//
// One bar is enough to check it against the contract. Exits 1 on a mismatch.
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const require = createRequire(path.join(process.cwd(), 'noop.js'));
const ts = require('typescript');

const here = path.dirname(fileURLToPath(import.meta.url));
const sharedIndex = path.resolve(here, '..', 'index.ts');
const bars = process.argv.slice(2).map(dir => path.resolve(dir));
if (!bars.length) {
  console.error('usage: check-bar-parity.mjs <bar dir> [<bar dir> ...]');
  process.exit(2);
}
const barIndexes = bars.map(dir => path.join(dir, 'index.ts'));

const program = ts.createProgram([sharedIndex, ...barIndexes], {
  jsx: ts.JsxEmit.ReactJSX,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ES2020,
  allowImportingTsExtensions: true,
  preserveSymlinks: true,
  skipLibCheck: true,
  noEmit: true,
});
const checker = program.getTypeChecker();

function exportsOf(file) {
  const source = program.getSourceFile(file);
  if (!source) throw new Error(`not found: ${file}`);
  const symbol = checker.getSymbolAtLocation(source);
  return new Set(checker.getExportsOfModule(symbol).map(s => s.getName()));
}

const BAR_OWN = ['Shell', 'default'];
const expected = new Set([...exportsOf(sharedIndex), ...BAR_OWN]);
let failed = false;
const lists = barIndexes.map(file => [path.basename(path.dirname(file)), exportsOf(file)]);

for (const [name, names] of lists) {
  const extra = [...names].filter(n => !expected.has(n));
  const missing = [...expected].filter(n => !names.has(n));
  if (extra.length || missing.length) {
    failed = true;
    console.error(`${name}: differs from the bar contract`);
    if (extra.length) console.error(`  extra:   ${extra.join(', ')}`);
    if (missing.length) console.error(`  missing: ${missing.join(', ')}`);
  } else {
    console.log(`${name}: ${names.size} exports, matches the bar contract`);
  }
}
for (let i = 1; i < lists.length; i++) {
  const [a, an] = lists[0];
  const [b, bn] = lists[i];
  const diff = [...an].filter(n => !bn.has(n)).concat([...bn].filter(n => !an.has(n)));
  if (diff.length) {
    failed = true;
    console.error(`${a} and ${b} differ: ${diff.join(', ')}`);
  } else {
    console.log(`${a} and ${b}: same ${an.size} exports`);
  }
}
process.exit(failed ? 1 : 0);
