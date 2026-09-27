// The architecture of the UI as a gate (docs/ARCHITECTURE.md), run by `npm run check`:
//
//   layering   components never import features; lib imports neither features nor components
//              (except the UI helpers named in LIB_UI_HELPERS); a feature imports another
//              feature only through features/shared and the modules in FEATURE_PUBLIC
//   size       a .ts or .svelte file of ui/src stays at MAX_LINES; a file in LARGE stays at
//              the ceiling written next to it
//   dead code  no file of ui/src or tools/ui-harness that nothing imports (ENTRIES excepted),
//              no export that nothing uses (no other file imports it, its own file does not
//              use it either)
//
// It reads the import graph with the TypeScript parser (the <script> blocks of .svelte files
// included) and resolves `$lib/`, `$components/`, relative paths and the harness's stand-in
// for @tauri-apps/api (tools/ui-harness/stub.ts). The other architecture rules live where
// their tool sees best: eslint.config.js (doors: Tauri, Lucide, motion, input; colours,
// px/ms, error messages), stylelint.config.js (tokens only) and core/tests/ui_contract.rs.
//
//     node tools/architecture.mjs          exits 1 and names each rule and its fix

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ policy */

/** Longest .ts or .svelte file of ui/src, in lines. Split a longer one along its parts. */
const MAX_LINES = 500;

/**
 * Files that may be longer, each with its ceiling and why (the generated types in
 * lib/ipc/types/ are not counted). `null`: no ceiling. A known large file's ceiling is its
 * length when it was listed, rounded up to the next 100: lower it when the file shrinks, drop
 * the entry below MAX_LINES, raise it only in a commit that says why the file cannot be split.
 */
const LARGE = {
  'ui/src/lib/i18n/de.ts': [null, 'the catalog: every text of the UI in one table'],
  'ui/src/lib/i18n/en.ts': [null, 'the catalog: mirrors de.ts key for key'],
  'ui/src/lib/input/input.ts': [1800, 'the one place of all input handling (CLAUDE.md)'],
  'ui/src/features/gallery/gallery.ts': [600, 'the samples of the gallery, one table'],
  // Known large files: split along their parts when next touched.
  'ui/src/features/jobs/Reader.svelte': [1700, 'known large: its sections become files'],
  'ui/src/features/profile/ProfileEditor.svelte': [1200, 'known large: one file per section'],
  'ui/src/lib/state/jobs.svelte.ts': [1100, 'known large: query, selection and moves apart'],
  'ui/src/features/jobs/JobList.svelte': [1100, 'known large: the rows apart from the list'],
  'ui/src/features/jobs/RunCard.svelte': [700, 'known large: the phases apart'],
  'ui/src/components/ChipInput.svelte': [700, 'known large: its editing keys into input.ts'],
  'ui/src/features/first-run/FirstRunView.svelte': [600, 'known large: one file per step'],
  'ui/src/features/profile/ProfileView.svelte': [600, 'known large: paste and save apart'],
  'ui/src/lib/state/profile.svelte.ts': [600, 'known large: the draft apart from the form'],
  'ui/src/lib/state/run.svelte.ts': [600, 'known large: the history apart from the run'],
};

/** lib modules that are UI helpers by design and may import a component (none today). */
const LIB_UI_HELPERS = {};

/** Modules a feature offers to the others (besides everything in features/shared/). */
const FEATURE_PUBLIC = {
  'ui/src/features/jobs/actions.ts':
    'the actions of a job (move, favourite, open) every job row offers',
  'ui/src/features/jobs/prompt.ts': 'copies the AI prompt of one job or a comparison',
  'ui/src/features/jobs/addToProfile.ts': 'takes a word of an ad into the profile, with undo',
};

/**
 * Findings accepted for a while, each with the TODO that removes it. The check fails when an
 * entry no longer matches anything, so a fixed finding also drops its entry.
 */
const TEMPORARY = {
  'ui/src/lib/facts.ts: rowFacts':
    'the list rows show no facts any more (track J1); lib/facts.ts is track J2s, which drops it',
};
const temporaryUsed = new Set();
/** Whether `key` is accepted for now (and remember that its entry is still needed). */
const temporary = (key) => {
  if (!(key in TEMPORARY)) return false;
  temporaryUsed.add(key);
  return true;
};

/** Files nothing imports because a tool loads them. */
const ENTRIES = {
  'ui/src/main.ts': 'ui/index.html',
  'ui/src/env.d.ts': 'ambient types (tsconfig)',
  'tools/ui-harness/playwright.config.ts': 'playwright -c',
  'tools/ui-harness/stub.ts': 'the harness build swaps @tauri-apps/api for it (ui/vite.config.ts)',
};
/** Playwright finds the specs by their name. */
const isEntry = (path) => path in ENTRIES || /^tools\/ui-harness\/specs\/.*\.spec\.ts$/.test(path);

/** Fewer files than this: the UI moved, and the rules would pass on nothing. */
const MIN_FILES = 200;

/* ------------------------------------------------------------------- files */

const SOURCE = /\.(ts|svelte|css)$/;

function walk(dir, out = []) {
  for (const entry of readdirSync(join(repo, dir), { withFileTypes: true })) {
    const path = posix.join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (SOURCE.test(entry.name)) out.push(path);
  }
  return out;
}

const GENERATED = 'ui/src/lib/ipc/types/';
const files = [...walk('ui/src'), ...walk('tools/ui-harness/specs'), ...harnessRoot()];
const known = new Set(files);

function harnessRoot() {
  return readdirSync(join(repo, 'tools/ui-harness'))
    .filter((name) => name.endsWith('.ts'))
    .map((name) => `tools/ui-harness/${name}`);
}

/* ------------------------------------------------------------------- parse */

/** The script of a file: the whole .ts, the <script> blocks of a .svelte (module flagged). */
function scripts(path, text) {
  if (path.endsWith('.ts')) return [{ code: text, module: true, offset: 0 }];
  if (!path.endsWith('.svelte')) return [];
  const out = [];
  for (const match of text.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    const offset = text.slice(0, match.index).split('\n').length - 1;
    out.push({ code: match[2], module: /\bmodule\b|context="module"/.test(match[1]), offset });
  }
  return out;
}

/** Imports (specifier, the names taken, `*` for all) and exports (name to line) of one file. */
function parse(path) {
  const text = readFileSync(join(repo, path), 'utf8');
  const imports = [];
  const exports = new Map();
  /** How often each identifier appears in the file (the markup of a .svelte included). */
  const names = new Map();
  const count = (name) => names.set(name, (names.get(name) ?? 0) + 1);
  if (path.endsWith('.css')) return { text, imports, exports, names };
  if (path.endsWith('.svelte')) {
    exports.set('default', 1);
    const markup = text.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, '');
    for (const [word] of markup.matchAll(/[A-Za-z_$][\w$]*/g)) count(word);
  }
  for (const block of scripts(path, text)) {
    const source = ts.createSourceFile(path, block.code, ts.ScriptTarget.Latest, true);
    const line = (node) =>
      source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 + block.offset;
    const take = (spec, names, node) => imports.push({ spec, names, line: line(node) });
    const exported = (name, node) => block.module && exports.set(name, line(node));
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        const names = new Set();
        if (clause?.name) names.add('default');
        const bindings = clause?.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) names.add('*');
        if (bindings && ts.isNamedImports(bindings))
          for (const el of bindings.elements) names.add((el.propertyName ?? el.name).text);
        take(statement.moduleSpecifier.text, names, statement);
      } else if (ts.isExportDeclaration(statement)) {
        const clause = statement.exportClause;
        const names = new Set();
        if (!clause || ts.isNamespaceExport(clause)) names.add('*');
        if (clause && ts.isNamespaceExport(clause)) exported(clause.name.text, statement);
        if (clause && ts.isNamedExports(clause))
          for (const el of clause.elements) {
            names.add((el.propertyName ?? el.name).text);
            exported(el.name.text, el);
          }
        if (statement.moduleSpecifier) take(statement.moduleSpecifier.text, names, statement);
      } else if (ts.isExportAssignment(statement)) {
        exported('default', statement);
      } else if (ts.canHaveModifiers(statement)) {
        const modifiers = ts.getModifiers(statement) ?? [];
        if (!modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
        if (modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword))
          exported('default', statement);
        else if (ts.isVariableStatement(statement))
          for (const d of statement.declarationList.declarations)
            if (ts.isIdentifier(d.name)) exported(d.name.text, d);
            else exported('*', d);
        else if (statement.name) exported(statement.name.text, statement);
      }
    }
    // import('x') and import('x').Type anywhere in the code; every identifier.
    const visit = (node) => {
      if (ts.isIdentifier(node)) count(node.text);
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        take(node.arguments[0].text, new Set(['*']), node);
      if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteral(node.argument.literal)
      ) {
        const first = node.qualifier && ts.isIdentifier(node.qualifier) ? node.qualifier.text : '*';
        take(node.argument.literal.text, new Set([first]), node);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { text, imports, exports, names };
}

/* ----------------------------------------------------------------- resolve */

const STUB = 'tools/ui-harness/stub.ts';

/** The repo path an import specifier of `from` names, or null for a package. */
function resolve(from, spec) {
  if (spec.startsWith('@tauri-apps/api')) return STUB;
  let base;
  if (spec.startsWith('$lib/')) base = `ui/src/lib/${spec.slice(5)}`;
  else if (spec.startsWith('$components/')) base = `ui/src/components/${spec.slice(12)}`;
  else if (spec.startsWith('.')) base = posix.normalize(posix.join(posix.dirname(from), spec));
  else return null;
  base = posix.normalize(base);
  const candidates = [base, `${base}.ts`, `${base}/index.ts`, base.replace(/\.js$/, '.ts')];
  const isFile = (c) => existsSync(join(repo, c)) && statSync(join(repo, c)).isFile();
  return candidates.find((c) => known.has(c)) ?? candidates.find(isFile) ?? base;
}

/* ------------------------------------------------------------------- graph */

const parsed = new Map(files.map((path) => [path, parse(path)]));
/** For each file: who imports it, and which of its names are taken. */
const importers = new Map(files.map((path) => [path, new Set()]));
const taken = new Map(files.map((path) => [path, new Set()]));
const edges = [];

for (const [path, { imports }] of parsed) {
  for (const { spec, names, line } of imports) {
    const target = resolve(path, spec);
    if (!target) continue;
    edges.push({ from: path, to: target, line });
    if (!parsed.has(target)) continue;
    if (target !== path) importers.get(target).add(path);
    for (const name of names) taken.get(target).add(name);
  }
}

/* ------------------------------------------------------------------- rules */

const problems = [];
if (parsed.size < MIN_FILES)
  problems.push(`Scan: only ${parsed.size} files found (at least ${MIN_FILES}): did the UI move?`);
const report = (rule, fix, list) => {
  if (list.length) problems.push(`${rule}\n  fix: ${fix}\n    ${list.join('\n    ')}`);
};

/** The layer of a UI file: components, lib, feature:<name>, app, or null outside the UI. */
function layer(path) {
  if (!path.startsWith('ui/src/')) return null;
  const rest = path.slice('ui/src/'.length);
  if (rest.startsWith('components/')) return 'components';
  if (rest.startsWith('lib/')) return 'lib';
  if (rest.startsWith('features/')) return `feature:${rest.split('/')[1]}`;
  return 'app';
}

const layering = { components: [], lib: [], features: [] };
for (const { from, to, line } of edges) {
  const [a, b] = [layer(from), layer(to)];
  if (!a || !b || a === b || temporary(`${from} -> ${to}`)) continue;
  const at = `${from}:${line} -> ${to}`;
  if (a === 'components' && b.startsWith('feature:')) layering.components.push(at);
  if (a === 'lib' && (b === 'components' || b.startsWith('feature:')) && !LIB_UI_HELPERS[from])
    layering.lib.push(at);
  if (
    a.startsWith('feature:') &&
    b.startsWith('feature:') &&
    b !== 'feature:shared' &&
    !FEATURE_PUBLIC[to]
  )
    layering.features.push(at);
}
report(
  'Layering: a component never imports a feature',
  'pass the data in as props or move the shared part into components/ or lib/',
  layering.components,
);
report(
  'Layering: lib never imports components or features',
  'move the code into the feature, or name the module in LIB_UI_HELPERS with its reason',
  layering.lib,
);
report(
  "Layering: a feature never imports another feature's internals",
  'move the shared part to features/shared/ or lib/state/, or name the module in FEATURE_PUBLIC',
  layering.features,
);

const long = [];
for (const [path, { text }] of parsed) {
  if (!path.startsWith('ui/src/') || path.startsWith(GENERATED) || path.endsWith('.css')) continue;
  const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  const ceiling = path in LARGE ? LARGE[path][0] : MAX_LINES;
  if (ceiling !== null && lines > ceiling)
    long.push(`${path}: ${lines} lines (at most ${ceiling})`);
  if (ceiling !== null && ceiling > MAX_LINES && lines <= MAX_LINES)
    long.push(`${path}: ${lines} lines, below ${MAX_LINES} (drop its LARGE entry)`);
}
for (const path of Object.keys(LARGE))
  if (!parsed.has(path)) long.push(`${path}: in LARGE but gone (drop the entry)`);
report(
  `Size: a file of ui/src stays at ${MAX_LINES} lines`,
  'split it along its parts (a section, a table, a helper); a LARGE ceiling goes down, not up',
  long,
);

// Dead code is code nothing uses: an export that no other file imports and its own file does
// not use either (an export its own file uses is alive; the `export` is only a spare door).
const orphans = [];
const unusedExports = [];
for (const [path, { exports, names }] of parsed) {
  if (path.startsWith(GENERATED)) continue;
  if (!isEntry(path) && importers.get(path).size === 0) {
    orphans.push(path);
    continue;
  }
  const used = taken.get(path);
  if (used.has('*')) continue;
  for (const [name, line] of exports) {
    // A default export is the file itself (a component, a config): the file rule covers it.
    if (name === '*' || name === 'default' || used.has(name)) continue;
    if ((names.get(name) ?? 0) > 1 || temporary(`${path}: ${name}`)) continue;
    unusedExports.push(`${path}:${line}: ${name}`);
  }
}
report(
  'Dead code: every file is imported',
  'delete the file, or name it in ENTRIES when a tool loads it',
  orphans,
);
report(
  'Dead code: every export is used (imported elsewhere or used in its own file)',
  'delete it',
  unusedExports,
);
report(
  'Temporary exceptions end with their finding',
  'delete the entry of TEMPORARY in tools/architecture.mjs',
  Object.keys(TEMPORARY).filter((key) => !temporaryUsed.has(key)),
);

if (problems.length) {
  console.error(`tools/architecture.mjs (docs/ARCHITECTURE.md):\n\n${problems.join('\n\n')}`);
  process.exit(1);
}
console.log(
  `architecture: ${parsed.size} files, ${edges.length} imports: layering, size and dead code ok`,
);
