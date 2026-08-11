#!/usr/bin/env node
// Statically validates per-form/Fabric.tsx schema field definitions against
// the fixed catalog of field types Fabric.tsx actually implements — see
// ../SKILL.md for the full property reference this table mirrors. Uses the
// real TypeScript compiler API (already a devDependency) to walk object
// literals, rather than regex, so multi-line objects, nested braces, and
// string contents containing the word "type" don't produce false hits.
//
// Usage:
//   node validate-schema.cjs <file.ts|file.tsx> [more files...]
//   node validate-schema.cjs                      # scans all of src/
//
// Exit code: 1 if any ERROR found, 0 otherwise (warnings don't fail the run).

const ts = require('typescript');
const fs = require('fs');
const path = require('path');

// ─── The fixed catalog (keep in sync with Fabric.tsx's switch + SKILL.md) ──

// type -> extra property required to be present on the same object literal.
// Types not listed here have no required extra (or aren't a special case at
// all — see FREEFORM_TYPES below).
const REQUIRED_EXTRAS = {
  multicheckbox: 'fields',
  radio: 'options',
  select: 'options',
  'multi-select': 'options',
  picker: 'options',
  combobox: 'options',
  'gamepad-select': 'gamepadMappings',
  'image-upload': 'uploadFn',
  custom: 'onRender',
};

// Every type Fabric.tsx's switch explicitly special-cases (whether or not it
// has a required extra above).
const KNOWN_TYPES = new Set([
  'checkbox', 'multicheckbox', 'radio', 'select', 'multi-select',
  'gamepad-select', 'image-upload', 'picker', 'date', 'datetime',
  'combobox', 'timetoday', 'range', 'slider', 'button', 'signature',
  'tyre-position', 'custom',
]);

// Common values that are *intentionally* not special-cased — they fall
// through to the default plain TextField on purpose (only 'date'/'number'/
// 'text' additionally affect the submit-time converter; the rest are just
// conventional labels with no special behavior at all). Not typos.
const FREEFORM_SAFE_TYPES = new Set([
  'text', 'number', 'email', 'password', 'tel', 'url', 'textarea', 'search',
]);

// Keys that are accepted by the schema but currently do nothing at render
// time — see SKILL.md's "dead properties" section for why.
const DEAD_KEYS = ['display', 'hint'];

// A sibling key present on this object means "this is a ComponentSchema
// (Dashboard Designer's outer type/label/fields wrapper), not a per-form
// Field" — both shapes share `type`+`label`, so without this exclusion
// every ComponentSchema false-positives as an unrecognized field type.
// Note: a ComponentSchema may itself be nested inside a factory function's
// return expression (`(props) => ({ type, label, icon, ..., fields: {...} })`)
// rather than a top-level object literal — no special-casing needed for
// that here, since `visit()` below recurses into every descendant
// unconditionally (including arrow-function bodies), so the object literal
// is found and walked the same way either way.
const COMPONENT_SCHEMA_MARKERS = ['icon', 'allowChildren'];

// ─── Small utilities ────────────────────────────────────────────────────────

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function closestKnownType(value) {
  let best = null;
  let bestDist = Infinity;
  for (const known of KNOWN_TYPES) {
    const d = levenshtein(value, known);
    if (d < bestDist) { bestDist = d; best = known; }
  }
  return bestDist <= 2 ? best : null;
}

function walkFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip the form library implementations themselves — we're validating
      // schema *authors*, not per-form/Fabric.tsx's own internals.
      if (full.includes(`${path.sep}per-form`) || full.endsWith('templates')) continue;
      walkFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// ─── AST walk ───────────────────────────────────────────────────────────────

function propNames(objLiteral) {
  const names = new Set();
  for (const prop of objLiteral.properties) {
    if ((ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) && prop.name) {
      if (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) {
        names.add(prop.name.text);
      }
    }
  }
  return names;
}

function getStringProp(objLiteral, key) {
  for (const prop of objLiteral.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ((ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) && prop.name.text === key)
    ) {
      return ts.isStringLiteral(prop.initializer) ? prop.initializer.text : undefined;
    }
  }
  return undefined;
}

function checkFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const findings = [];

  function lineOf(node) {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  }

  function visit(node) {
    if (ts.isObjectLiteralExpression(node)) {
      const names = propNames(node);
      // Heuristic for "this is a per-form Field definition": both `type`
      // and `label` are required, non-optional keys on per-form's own
      // `Field` interface, and co-occurring as sibling string-ish
      // properties is not a pattern anything else in this codebase uses
      // coincidentally.
      const isComponentSchema = COMPONENT_SCHEMA_MARKERS.some(k => names.has(k));
      // A per-form Field is always the *value of a named property* in a
      // schema object (`{ fieldName: { type, label, ... } }`) — never an
      // element of an array. Excludes unrelated type+label shapes like
      // BaseDashTypeInfo's BASE_DASH_TYPES: BaseDashTypeInfo[].
      const isArrayElement = node.parent && ts.isArrayLiteralExpression(node.parent);
      if (names.has('type') && names.has('label') && !isComponentSchema && !isArrayElement) {
        const typeValue = getStringProp(node, 'type');
        if (typeValue === undefined) {
          // `type` isn't a plain string literal (e.g. computed) — can't
          // statically check it, skip rather than guess.
        } else {
          const requiredExtra = REQUIRED_EXTRAS[typeValue];
          if (requiredExtra && !names.has(requiredExtra)) {
            if (typeValue === 'gamepad-select') {
              // The only two real usages today (button-control/slider-control
              // schemas) deliberately omit this — ObjectExplorer.tsx's
              // perFormSchema injects it at render time. Also: this whole
              // field type is slated for replacement by a generalized
              // "list" field, so this is a soft note, not a hard failure.
              findings.push({
                level: 'WARN',
                line: lineOf(node),
                message: `type: 'gamepad-select' has no static 'gamepadMappings' — fine if a call site injects it at render time (see ObjectExplorer.tsx's perFormSchema), otherwise this dropdown renders empty. (gamepad-select is slated for replacement by a generalized 'list' field.)`,
              });
            } else {
              findings.push({
                level: 'ERROR',
                line: lineOf(node),
                message: `type: '${typeValue}' requires a '${requiredExtra}' property, none found on this field`,
              });
            }
          }
          if (!KNOWN_TYPES.has(typeValue) && !FREEFORM_SAFE_TYPES.has(typeValue)) {
            const suggestion = closestKnownType(typeValue);
            findings.push({
              level: 'WARN',
              line: lineOf(node),
              message: suggestion
                ? `type: '${typeValue}' is not a recognized type — did you mean '${suggestion}'? (otherwise it silently renders as a plain TextField)`
                : `type: '${typeValue}' is not one of the special-cased types — renders as a plain TextField. Fine if intentional.`,
            });
          }
        }
        for (const deadKey of DEAD_KEYS) {
          if (names.has(deadKey)) {
            findings.push({
              level: 'WARN',
              line: lineOf(node),
              message: `'${deadKey}' is set but currently has no effect anywhere in Fabric.tsx/FormWrapper (dead property, see SKILL.md)`,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const files = args.length > 0
    ? args.map(a => path.resolve(a))
    : walkFiles(path.join(repoRoot, 'src'));

  let errorCount = 0;
  let warnCount = 0;

  for (const file of files) {
    if (!fs.existsSync(file)) {
      console.error(`No such file: ${file}`);
      process.exitCode = 1;
      continue;
    }
    const findings = checkFile(file);
    if (findings.length === 0) continue;
    const rel = path.relative(repoRoot, file);
    for (const f of findings) {
      console.log(`${rel}:${f.line} [${f.level}] ${f.message}`);
      if (f.level === 'ERROR') errorCount++; else warnCount++;
    }
  }

  console.log(`\nChecked ${files.length} file(s). ${errorCount} error(s), ${warnCount} warning(s).`);
  if (errorCount > 0) process.exitCode = 1;
}

main();
