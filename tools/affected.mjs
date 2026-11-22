// The checks a change needs, from the files it touches: the Rust crates to lint, the unit tests
// of the core modules it reaches, the integration tests of core/tests that import or name what
// changed, `npm run check`, the check of docs/CODEMAP.md, the tests of a changed tool, and the
// Playwright specs of the touched UI area (Chromium). When a file's reach is unclear, the check
// is in: a missed test costs more than a run.
//
//     node tools/affected.mjs                 changes since the merge base with main
//     node tools/affected.mjs --base <ref>    changes since the merge base with <ref>
//     node tools/affected.mjs --staged        the staged changes only
//     node tools/affected.mjs --run           runs the commands, stops at the first failure
//
// It prints one command per line. tools/gate.mjs runs the same plan at the end of a block.
// The timing spec is left to the full harness (`npm run harness`), which runs before a push.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

export const CORE = 'jobalert-core';
export const TAURI = 'job-alert-monitor';
// The project's own harness script, in Chromium (npm run finds the tools in any parent folder).
const HARNESS = 'npm run harness -- --project=chromium';
const SPECS = 'tools/ui-harness/specs/';
const MAIN = 'ui/src/main.ts';
/** The frame every view sits in: a change that reaches it directly reaches every spec. */
const ROOTS = [MAIN, 'ui/src/App.svelte'];
const FEATURE = /^ui\/src\/features\/([^/]+)\//;
/** Specs only the full harness runs (the timing project, alone after both engines). */
const FULL_HARNESS_ONLY = ['timing'];

/** Files whose change reaches all Rust code. */
const RUST_WIDE =
  /^(Cargo\.(toml|lock)|rust-toolchain\.toml|clippy\.toml|\.cargo\/|core\/Cargo\.toml)/;
/** Files `npm run check` reads (prettier, eslint, svelte-check, tokens, architecture). */
const NPM_CHECKED =
  /^(ui\/|tools\/|cv-worker\/|[^/]+\.(js|mjs|cjs|ts|json)$|\.prettier|\.stylelint|src-tauri\/tauri[^/]*\.conf\.json$|core\/src\/export\/palette\.rs$)/;
/** What docs/CODEMAP.md maps (tools/codemap.mjs), and the docs its notes come from. */
const MAPPED =
  /^(core\/(src|tests|examples)\/|src-tauri\/(src\/|build\.rs$)|ui\/src\/|cv-worker\/src\/|tools\/|docs\/(ARCHITECTURE|CHANGING|CODEMAP)\.md$)/;
/** What the IPC contract tests (core/tests/contract.rs, the ipc_types test of view) cover. */
const CONTRACT =
  /^(core\/src\/view(\.rs|\/)|src-tauri\/src\/commands\/|src-tauri\/commands\.txt$|src-tauri\/build\.rs$|src-tauri\/capabilities\/|ui\/src\/lib\/ipc\/)/;

/* ------------------------------------------------------------------ plan */

/**
 * The checks for `changed` (repo-relative paths) from the repo's `facts` (collectFacts):
 * `{ fmt, clippy: Set<crate> | 'all', lib: Set<module> | 'all' | null, tests: Set<name>,
 *    tauriTests, workspaceTests, npm, codemap, nodeTests: Set<path>, specs: Set<stem> | 'all' }`.
 */
export function plan(changed, facts) {
  const out = {
    fmt: false,
    clippy: new Set(),
    lib: null,
    tests: new Set(),
    tauriTests: false,
    workspaceTests: false,
    npm: false,
    codemap: false,
    nodeTests: new Set(),
    specs: new Set(),
  };
  const libModules = (modules) => {
    if (out.lib === 'all' || modules === 'all') out.lib = 'all';
    else out.lib = new Set([...(out.lib ?? []), ...modules]);
  };
  let reached = new Set();
  for (const path of changed) {
    if (path.endsWith('.rs')) out.fmt = true;
    if (RUST_WIDE.test(path)) {
      out.fmt = out.workspaceTests = true;
      out.clippy = 'all';
    }
    if (path.startsWith('core/src/')) {
      const modules = facts.core.reach(facts.core.moduleOf(path));
      if (modules === 'all') reached = 'all';
      else if (reached !== 'all') for (const module of modules) reached.add(module);
      addCrate(out, CORE);
      libModules(modules === 'all' ? 'all' : [...modules].filter((m) => m !== 'lib'));
      if (modules === 'all' || facts.tauriUses.some((m) => modules.has(m))) {
        addCrate(out, TAURI);
        out.tauriTests = true;
      }
    }
    if (/^core\/(tests|examples)\//.test(path)) addCrate(out, CORE);
    if (path.startsWith('src-tauri/')) {
      addCrate(out, TAURI);
      out.tauriTests = true;
    }
    if (CONTRACT.test(path)) {
      out.tests.add('contract');
      libModules(['view']);
    }
    if (path.startsWith('ui/') && facts.tests.has('ui_contract')) out.tests.add('ui_contract');
    if (NPM_CHECKED.test(path)) out.npm = true;
    if (facts.codemap && MAPPED.test(path)) out.codemap = true;
    const tool = /^tools\/([^/]+?)(\.test)?\.mjs$/.exec(path);
    if (tool && facts.nodeTests.includes(`tools/${tool[1]}.test.mjs`))
      out.nodeTests.add(`tools/${tool[1]}.test.mjs`);
    const named = [...facts.tests].filter(([name, test]) => testReaches(test, name, path));
    for (const [name] of named) out.tests.add(name);
    // A fixture no test names (besides the sweeps over every file) may be read by any test.
    if (path.startsWith('core/tests/fixtures/') && named.every(([, test]) => test.everything)) {
      for (const name of facts.tests.keys()) out.tests.add(name);
    }
    if (path.startsWith('core/tests/snapshots/')) {
      const owner = /^core\/tests\/snapshots\/([^/]+?)__/.exec(path)?.[1];
      for (const name of owner && facts.tests.has(owner) ? [owner] : facts.tests.keys())
        out.tests.add(name);
    }
    addSpecs(out, path, facts.ui);
  }
  const touched = (m) => reached === 'all' || reached.has(m);
  for (const [name, test] of facts.tests) {
    if (
      reached === 'all' ||
      (reached.size && (test.modules === 'all' || [...test.modules].some(touched)))
    )
      out.tests.add(name);
  }
  // The core's modules use each other in circles, so a change often reaches all of them.
  const modules = [...facts.core.deps.keys()].filter((m) => m !== 'lib');
  if (out.lib instanceof Set && modules.every((m) => out.lib.has(m))) out.lib = 'all';
  if (out.lib === 'all' && out.tauriTests && out.tests.size === facts.tests.size)
    out.workspaceTests = true;
  return out;
}

function addCrate(out, crate) {
  if (out.clippy !== 'all') out.clippy.add(crate);
}

function testReaches(test, name, path) {
  if (test.everything || path === `core/tests/${name}.rs`) return true;
  return test.paths.some(
    (prefix) => path === prefix || path.startsWith(prefix.replace(/\/?$/, '/')),
  );
}

/* ------------------------------------------------------------- the specs */

function addSpecs(out, path, ui) {
  if (ui.frozen || out.specs === 'all' || !/^(ui|tools\/ui-harness)\//.test(path)) return;
  if (path.startsWith('tools/ui-harness/baselines/')) return;
  const spec = new RegExp(`^${SPECS}(.+)\\.spec\\.ts$`).exec(path);
  if (spec) return void out.specs.add(spec[1]);
  const all = () => void (out.specs = 'all');
  const users = ui.importersOf(path);
  const importing = ui.specs.filter((s) => users.has(s.path));
  if (!path.startsWith('ui/src/')) {
    // The harness's own files: the specs that import them; the config, the stub, its data: all.
    if (!importing.length || users.has(MAIN)) return all();
    for (const s of importing) out.specs.add(s.stem);
    return;
  }
  const region = ui.region(path);
  if (!region) return all(); // the shell's frame (App, main, styles) and what it uses itself
  const features = new Set(region.map((file) => FEATURE.exec(file)?.[1]).filter(Boolean));
  const ids = region.flatMap((file) => ui.ids(file));
  const name = kebab(posix.basename(path).replace(/(\.svelte)?\.(ts|svelte|css)$/, ''));
  for (const s of ui.specs) {
    const linked =
      importing.includes(s) ||
      !s.ids.length ||
      [...features].some((feature) => s.stem === feature || s.stem.startsWith(`${feature}-`)) ||
      s.ids.some((id) => ids.some((own) => sameId(id, own))) ||
      s.stem === name ||
      name.endsWith(`-${s.stem}`) ||
      name.startsWith(`${s.stem}-`) ||
      s.stem.startsWith(`${name}-`);
    if (linked) out.specs.add(s.stem);
  }
}

const kebab = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/** Test ids `{ id, prefix }` match when one names the other (a prefix ends in `${…}`). */
export function sameId(a, b) {
  if (!a.prefix && !b.prefix) return a.id === b.id;
  if (a.prefix && b.prefix) return a.id.startsWith(b.id) || b.id.startsWith(a.id);
  const [prefix, literal] = a.prefix ? [a, b] : [b, a];
  return literal.id.startsWith(prefix.id);
}

/* -------------------------------------------------------------- commands */

/** The plan as command lines, in the order they run best (cargo, npm, then the browser). */
export function commands(result) {
  const lines = [];
  if (result.fmt) lines.push('cargo fmt --all --check');
  if (result.clippy === 'all') lines.push('cargo clippy --workspace --all-targets -- -D warnings');
  else if (result.clippy.size)
    lines.push(
      `cargo clippy ${[...result.clippy]
        .sort()
        .map((c) => `-p ${c}`)
        .join(' ')} --all-targets -- -D warnings`,
    );
  if (result.workspaceTests) lines.push('cargo test --workspace --lib --tests');
  else {
    if (result.lib === 'all') lines.push(`cargo test -p ${CORE} --lib`);
    else if (result.lib?.size)
      lines.push(
        `cargo test -p ${CORE} --lib -- ${[...result.lib]
          .sort()
          .map((m) => `${m}::`)
          .join(' ')}`,
      );
    if (result.tests.size)
      lines.push(
        `cargo test -p ${CORE} ${[...result.tests]
          .sort()
          .map((t) => `--test ${t}`)
          .join(' ')}`,
      );
    if (result.tauriTests) lines.push(`cargo test -p ${TAURI}`);
  }
  if (result.npm) lines.push('npm run check');
  if (result.codemap) lines.push('node tools/codemap.mjs --check');
  if (result.nodeTests.size) lines.push(`node --test ${[...result.nodeTests].sort().join(' ')}`);
  if (result.specs === 'all') lines.push(HARNESS);
  else {
    const specs = [...result.specs].filter((stem) => !FULL_HARNESS_ONLY.includes(stem)).sort();
    if (specs.length) lines.push(`${HARNESS} ${specs.map((stem) => `${stem}.spec.ts`).join(' ')}`);
  }
  return lines;
}

/* ----------------------------------------------------------------- facts */

const read = (path) => readFileSync(join(repo, path), 'utf8').replace(/\r\n/g, '\n');

function git(...args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

const tracked = (...roots) =>
  git('ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...roots)
    .split('\0')
    .filter(
      (path) => path && !path.startsWith('core/tests/fixtures/') && existsSync(join(repo, path)),
    );

/** Names after `prefix::` in Rust code, `prefix::{a, b::c}` groups included. */
export function rustPaths(text, prefix) {
  const names = [];
  const re = new RegExp(`\\b${prefix}::(\\{|\\w+)`, 'g');
  for (let match; (match = re.exec(text));) {
    if (match[1] !== '{') {
      names.push(match[1]);
      continue;
    }
    let depth = 1;
    let part = '';
    for (let i = re.lastIndex; i < text.length && depth > 0; i++) {
      const char = text[i];
      if (char === '{') depth++;
      if (char === '}') depth--;
      if (depth === 1 && char === ',') {
        names.push(part);
        part = '';
      } else if (depth >= 1) part += char;
      if (depth === 0) names.push(part);
    }
  }
  return names.map((name) => /^\s*(\w+)/.exec(name)?.[1]).filter((name) => name && name !== 'self');
}

/** The core crate as a graph of its top-level modules. */
export function coreGraph(files) {
  const moduleOf = (path) => {
    const rest = path.slice('core/src/'.length);
    if (rest === 'lib.rs') return 'all';
    return rest.split('/')[0].replace(/\.rs$/, '');
  };
  const libText = files['core/src/lib.rs'] ?? '';
  const modules = new Set(
    Object.keys(files)
      .map(moduleOf)
      .filter((m) => m !== 'all'),
  );
  const reexports = new Map();
  for (const [, from, list] of libText.matchAll(/^pub use (\w+)::\{?([^;}]+)\}?;/gm))
    for (const name of list.split(','))
      reexports.set(
        name
          .trim()
          .split(/\s+as\s+/)
          .pop(),
        from,
      );
  const resolve = (name) =>
    modules.has(name)
      ? name
      : (reexports.get(name) ??
        (new RegExp(`\\b(fn|const|static|struct|enum|type) ${name}\\b`).test(libText)
          ? 'lib'
          : 'all'));
  const deps = new Map([...modules, 'lib'].map((m) => [m, new Set()]));
  for (const [path, text] of Object.entries(files)) {
    const from = moduleOf(path);
    if (from === 'all') {
      const used = [...libText.matchAll(/\b(\w+)::/g)]
        .map((m) => m[1])
        .filter((m) => modules.has(m));
      for (const m of used) deps.get('lib').add(m);
      continue;
    }
    for (const name of rustPaths(text, 'crate')) {
      const to = resolve(name);
      if (to === 'all') for (const m of modules) deps.get(from).add(m);
      else if (to !== from) deps.get(from).add(to);
    }
  }
  /** The modules a change of `module` reaches: itself and everything that uses it. */
  const reach = (module) => {
    if (module === 'all' || !deps.has(module)) return 'all';
    const seen = new Set([module]);
    for (let grew = true; grew;) {
      grew = false;
      for (const [m, uses] of deps)
        if (!seen.has(m) && [...uses].some((u) => seen.has(u))) grew = seen.add(m);
    }
    return seen;
  };
  return { moduleOf, resolve, reach, deps };
}

/** What one integration test uses: core modules, repo paths it names, all files. */
export function testFacts(text, resolve, included = []) {
  const all = [text, ...included.map(([, body]) => body)].join('\n');
  const modules = new Set();
  for (const name of rustPaths(all, 'jobalert_core')) {
    const module = resolve(name);
    if (module === 'all') return { modules: 'all', ...namedPaths(all, included) };
    modules.add(module);
  }
  return { modules, ...namedPaths(all, included) };
}

function namedPaths(text, included) {
  const paths = included.map(([path]) => path);
  for (const [, literal] of text.matchAll(
    /"([^"\s]*\/[^"\s]*|[\w.-]+\.(?:toml|json|ts|rs|md))"/g,
  )) {
    let path = literal.split('{')[0].replace(/^(\.\.?\/)+/, '');
    if (/^\/?(tests|src|examples)\//.test(path) || path === 'Cargo.toml')
      path = `core/${path.replace(/^\//, '')}`;
    if (/^(core|ui|src-tauri|tools|docs|cv-worker)\//.test(path)) paths.push(path);
  }
  return { paths: [...new Set(paths)], everything: /"ls-files"/.test(text) };
}

/** Relative and aliased imports of a TS or Svelte file, resolved against `known` files. */
export function importsOf(path, text, known) {
  const out = new Set();
  const re =
    /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|new URL\(\s*['"]([^'"]+)['"]/g;
  for (const match of text.matchAll(re)) {
    const spec = match[1] ?? match[2] ?? match[3] ?? match[4];
    let base;
    if (spec.startsWith('.')) base = posix.join(posix.dirname(path), spec);
    else if (spec.startsWith('$lib/')) base = `ui/src/lib/${spec.slice(5)}`;
    else if (spec.startsWith('$components/')) base = `ui/src/components/${spec.slice(12)}`;
    else if (spec.startsWith('@tauri-apps/api')) base = 'tools/ui-harness/stub.ts';
    else continue;
    const hit = ['', '.ts', '.js', '.svelte.ts', '/index.ts']
      .map((ext) => base + ext)
      .find((f) => known.has(f));
    if (hit) out.add(hit);
  }
  return out;
}

/** Test ids a UI file sets (`testid="x"`, `data-testid="x-{…}"`, `testid: 'x'`). */
export function definedIds(text) {
  const ids = [];
  const re = /\b(?:data-)?testid\s*[=:]\s*\{?\s*(['"`])([A-Za-z0-9_-]*)(\$?\{)?/g;
  for (const [, , id, open] of text.matchAll(re)) if (id) ids.push({ id, prefix: Boolean(open) });
  return ids;
}

/** Test ids a spec looks for. */
export function usedIds(text) {
  const ids = [];
  for (const [, , id, open] of text.matchAll(/getByTestId\(\s*(['"`])([A-Za-z0-9_-]+)(\$\{)?/g))
    ids.push({ id, prefix: Boolean(open) });
  for (const [, op, id] of text.matchAll(/data-testid([\^*]?)=\\?["']?([A-Za-z0-9_-]+)/g))
    ids.push({ id, prefix: Boolean(op) });
  return ids;
}

/** Everything plan() needs to know about the repo, read from the working tree. */
export function collectFacts() {
  const coreFiles = Object.fromEntries(
    tracked('core/src')
      .filter((p) => p.endsWith('.rs'))
      .map((p) => [p, read(p)]),
  );
  const core = coreGraph(coreFiles);
  const tests = new Map();
  for (const path of tracked('core/tests').filter((p) => /^core\/tests\/[^/]+\.rs$/.test(p))) {
    const text = read(path);
    const included = [];
    for (const [, target] of text.matchAll(/#\[path\s*=\s*"([^"]+)"\]/g)) {
      const file = posix.normalize(posix.join('core/tests', target));
      const dir = file.endsWith('mod.rs') ? posix.dirname(file) : null;
      for (const p of dir ? tracked(dir) : [file])
        if (p.endsWith('.rs')) included.push([p, read(p)]);
    }
    for (const [, name] of text.matchAll(/^mod (\w+);/gm)) {
      for (const p of tracked(`core/tests/${name}`, `core/tests/${name}.rs`))
        included.push([p, read(p)]);
    }
    tests.set(posix.basename(path, '.rs'), testFacts(text, core.resolve, included));
  }
  const tauriUses = [
    ...new Set(
      tracked('src-tauri/src')
        .filter((p) => p.endsWith('.rs'))
        .flatMap((p) => rustPaths(read(p), 'jobalert_core').map(core.resolve)),
    ),
  ];
  return {
    core,
    tests,
    tauriUses: tauriUses.includes('all') ? [...core.deps.keys()] : tauriUses,
    codemap: existsSync(join(repo, 'tools/codemap.mjs')),
    nodeTests: tracked('tools').filter((p) => /^tools\/[^/]+\.test\.mjs$/.test(p)),
    ui: { ...uiFacts(), frozen: uiFrozen() },
  };
}

/**
 * Main's old UI is frozen until the new one lands (CLAUDE.md "Commands"): its type check is
 * off, so no spec of it runs either. The type check in package.json is the one place that says so.
 */
function uiFrozen() {
  const scripts = JSON.parse(read('package.json')).scripts ?? {};
  return !String(scripts['check:types'] ?? '').includes('svelte-check');
}

function uiFacts() {
  const files = tracked('ui/src', 'tools/ui-harness').filter((p) =>
    /\.(ts|svelte|js|json|css)$/.test(p),
  );
  const known = new Set(files);
  const texts = new Map(files.map((p) => [p, read(p)]));
  const imports = new Map();
  const importers = new Map(files.map((p) => [p, new Set()]));
  for (const [path, text] of texts) {
    if (!/.(ts|svelte|js)$/.test(path)) continue;
    imports.set(path, importsOf(path, text, known));
    for (const target of imports.get(path)) importers.get(target).add(path);
  }
  /** Every file reached from `path` along `edges`, through the files `through` admits. */
  const walk = (path, edges, through = () => true) => {
    const seen = new Set();
    const queue = [path];
    while (queue.length)
      for (const next of edges.get(queue.pop()) ?? [])
        if (!seen.has(next) && seen.add(next) && through(next)) queue.push(next);
    return seen;
  };
  const featureView = (file) => FEATURE.test(file) && file.endsWith('.svelte');
  /**
   * The files where a change of `path` shows: a feature's view with the views it holds; anything
   * else in the views that use it (through tables, state and components). Null for the frame.
   */
  const region = (path) => {
    if (featureView(path))
      return [path, ...walk(path, imports, (f) => FEATURE.test(f))].filter((f) => FEATURE.test(f));
    const users = [...walk(path, importers, (f) => !featureView(f) && !ROOTS.includes(f))];
    if (users.some((f) => ROOTS.includes(f))) return null;
    const shown = [path, ...users].filter((f) => f.startsWith('ui/src/'));
    return shown.some((f) => FEATURE.test(f)) ? shown : null;
  };
  const specs = files
    .filter((p) => p.startsWith(SPECS) && p.endsWith('.spec.ts'))
    .map((p) => ({ path: p, stem: posix.basename(p, '.spec.ts'), ids: usedIds(texts.get(p)) }));
  return {
    importersOf: (path) => walk(path, importers),
    region,
    ids: (path) => (texts.has(path) ? definedIds(texts.get(path)) : []),
    specs,
  };
}

/* ------------------------------------------------------------------- git */

/** Changed files: since the merge base with `base` (working tree and new files), or staged. */
export function changedFiles({ base = 'main', staged = false } = {}) {
  const lines = (out) => out.split('\n').filter(Boolean);
  if (staged) return lines(git('diff', '--name-only', '--cached', '--no-renames')).sort();
  let since = base;
  try {
    since = git('merge-base', base, 'HEAD').trim();
  } catch {
    // no common history: compare with the ref itself
  }
  const diff = lines(git('diff', '--name-only', '--no-renames', since));
  const fresh = lines(git('ls-files', '--others', '--exclude-standard'));
  return [...new Set([...diff, ...fresh])]
    .filter((p) => !p.startsWith('core/tests/fixtures/private/'))
    .sort();
}

export function parseArgs(argv) {
  const options = { base: 'main', staged: false, run: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') options.base = argv[++i];
    else if (argv[i] === '--staged') options.staged = true;
    else if (argv[i] === '--run') options.run = true;
  }
  return options;
}

/** The commands for the current change, from the repo. */
export function affectedCommands(options) {
  const changed = changedFiles(options);
  if (!changed.length) return [];
  return commands(plan(changed, collectFacts()));
}

/** True when `meta` is the module node was started with (not imported by a test or the gate). */
export const isMain = (meta) =>
  Boolean(process.argv[1]) &&
  resolvePath(process.argv[1]).toLowerCase() === fileURLToPath(meta.url).toLowerCase();

if (isMain(import.meta)) {
  const options = parseArgs(process.argv.slice(2));
  const lines = affectedCommands(options);
  if (!options.run) {
    console.log(lines.length ? lines.join('\n') : '# nothing changed');
  } else {
    for (const line of lines) {
      console.log(`> ${line}`);
      const { status } = spawnSync(line, { cwd: repo, shell: true, stdio: 'inherit' });
      if (status !== 0) process.exit(1);
    }
  }
}
