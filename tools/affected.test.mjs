// Unit tests of the mapping in tools/affected.mjs, on a small invented repo (and one look at the
// real one).
//
//     node --test tools/affected.test.mjs

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CORE,
  TAURI,
  collectFacts,
  commands,
  coreGraph,
  definedIds,
  importsOf,
  parseArgs,
  plan,
  rustPaths,
  sameId,
  testFacts,
  usedIds,
} from './affected.mjs';

const core = coreGraph({
  'core/src/lib.rs':
    'pub mod a;\npub mod b;\npub use a::{Error, Result};\npub fn root() -> b::X {}',
  'core/src/a.rs': 'pub struct Error;',
  'core/src/b/mod.rs': 'use crate::a::Error;',
  'core/src/b/inner.rs': 'use super::X;',
  'core/src/c.rs': 'use crate::{b::X, Error};',
  'core/src/d.rs': 'pub fn alone() {}',
});

const spec = (stem, ids = [{ id: 'other', prefix: false }]) => ({
  path: `tools/ui-harness/specs/${stem}.spec.ts`,
  stem,
  ids,
});

/** The invented repo: four core modules, five tests, a jobs feature and four specs. */
const facts = {
  core,
  tests: new Map([
    ['uses_c', testFacts('use jobalert_core::c::Thing;', core.resolve)],
    ['uses_root', testFacts('jobalert_core::root();', core.resolve)],
    ['names_ui', testFacts('let dir = "ui/src";', core.resolve)],
    [
      'fixtures',
      testFacts('concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/mails")', core.resolve),
    ],
    ['sweep', testFacts('Command::new("git").args(["ls-files"])', core.resolve)],
    ['contract', testFacts('', core.resolve)],
    ['ui_contract', testFacts('', core.resolve)],
  ]),
  tauriUses: ['b'],
  codemap: true,
  nodeTests: ['tools/affected.test.mjs'],
  ui: {
    importersOf: (path) =>
      new Set(
        path === 'tools/ui-harness/specs/helpers.ts' ? ['tools/ui-harness/specs/list.spec.ts'] : [],
      ),
    region: (path) =>
      path.startsWith('ui/src/features/') ? [path] : path === 'ui/src/App.svelte' ? null : [path],
    ids: (path) => (path.endsWith('Reader.svelte') ? [{ id: 'reader-', prefix: true }] : []),
    specs: [
      spec('reader', [{ id: 'reader-title', prefix: false }]),
      spec('list'),
      spec('jobs'),
      spec('timing'),
    ],
  },
};

const run = (...changed) => commands(plan(changed, facts));

test('a module change reaches its users, the tests that import them and the shell', () => {
  assert.deepEqual(run('core/src/a.rs'), [
    'cargo fmt --all --check',
    `cargo clippy -p ${TAURI} -p ${CORE} --all-targets -- -D warnings`,
    `cargo test -p ${CORE} --lib -- a:: b:: c::`,
    `cargo test -p ${CORE} --test sweep --test uses_c --test uses_root`,
    `cargo test -p ${TAURI}`,
    'node tools/codemap.mjs --check',
  ]);
});

test('a module nobody uses reaches only its own tests', () => {
  assert.deepEqual(run('core/src/d.rs'), [
    'cargo fmt --all --check',
    `cargo clippy -p ${CORE} --all-targets -- -D warnings`,
    `cargo test -p ${CORE} --lib -- d::`,
    `cargo test -p ${CORE} --test sweep`,
    'node tools/codemap.mjs --check',
  ]);
});

test('lib.rs and the manifests reach everything', () => {
  const lib = plan(['core/src/lib.rs'], facts);
  assert.equal(lib.lib, 'all');
  assert.equal(lib.tests.size, facts.tests.size);
  assert.ok(lib.workspaceTests);
  assert.deepEqual(run('Cargo.lock'), [
    'cargo fmt --all --check',
    'cargo clippy --workspace --all-targets -- -D warnings',
    'cargo test --workspace --lib --tests',
  ]);
});

test('a UI view reaches the UI checks and the specs of its test ids, never clippy', () => {
  assert.deepEqual(run('ui/src/features/jobs/Reader.svelte'), [
    `cargo test -p ${CORE} --test names_ui --test sweep --test ui_contract`,
    'npm run check',
    'node tools/codemap.mjs --check',
    'npm run harness -- --project=chromium jobs.spec.ts reader.spec.ts',
  ]);
});

test('the frame reaches every spec; the timing spec waits for the full harness', () => {
  assert.equal(plan(['ui/src/App.svelte'], facts).specs, 'all');
  assert.ok(run('ui/src/App.svelte').includes('npm run harness -- --project=chromium'));
  assert.deepEqual(run('tools/ui-harness/specs/timing.spec.ts'), [
    `cargo test -p ${CORE} --test sweep`,
    'npm run check',
    'node tools/codemap.mjs --check',
  ]);
});

test('a spec reaches itself, a helper the specs that import it, the config all', () => {
  assert.deepEqual([...plan(['tools/ui-harness/specs/reader.spec.ts'], facts).specs], ['reader']);
  assert.deepEqual([...plan(['tools/ui-harness/specs/helpers.ts'], facts).specs], ['list']);
  assert.equal(plan(['tools/ui-harness/playwright.config.ts'], facts).specs, 'all');
  assert.equal(plan(['tools/ui-harness/baselines/chromium/a.png'], facts).specs.size, 0);
});

test('commands, generated types and view.rs reach the contract tests', () => {
  for (const path of [
    'src-tauri/commands.txt',
    'ui/src/lib/ipc/types/JobView.ts',
    'core/src/view.rs',
  ]) {
    const result = plan([path], facts);
    assert.ok(result.tests.has('contract'), path);
    assert.ok(result.lib === 'all' || result.lib.has('view'), path);
  }
});

test('snapshots and fixtures reach the tests that own them', () => {
  assert.deepEqual([...plan(['core/tests/snapshots/uses_c__one.snap'], facts).tests].sort(), [
    'sweep',
    'uses_c',
  ]);
  assert.deepEqual([...plan(['core/tests/fixtures/mails/a.eml'], facts).tests].sort(), [
    'fixtures',
    'sweep',
  ]);
  assert.equal(plan(['core/tests/fixtures/pages/a.html'], facts).tests.size, facts.tests.size);
});

test('docs reach the sweep, the sources of the map its check, a tool its tests', () => {
  assert.deepEqual(run('docs/PLAN.md'), [`cargo test -p ${CORE} --test sweep`]);
  assert.deepEqual(run('docs/CHANGING.md'), [
    `cargo test -p ${CORE} --test sweep`,
    'node tools/codemap.mjs --check',
  ]);
  assert.deepEqual(run('tools/affected.mjs'), [
    `cargo test -p ${CORE} --test sweep`,
    'npm run check',
    'node tools/codemap.mjs --check',
    'node --test tools/affected.test.mjs',
  ]);
});

test('Rust paths, groups included', () => {
  assert.deepEqual(
    rustPaths('use jobalert_core::{matching::{a, b}, portal, self};', 'jobalert_core'),
    ['matching', 'portal'],
  );
  assert.deepEqual(rustPaths('crate::model::Job; crate::Error', 'crate'), ['model', 'Error']);
  assert.equal(core.resolve('Error'), 'a');
  assert.equal(core.resolve('root'), 'lib');
  assert.equal(core.resolve('unknown'), 'all');
  assert.deepEqual([...core.reach('d')], ['d']);
  assert.equal(core.reach('gone'), 'all');
});

test('imports resolve aliases, extensions and the stub', () => {
  const known = new Set([
    'ui/src/lib/a.ts',
    'ui/src/lib/state/b.svelte.ts',
    'ui/src/components/Button.svelte',
    'tools/ui-harness/stub.ts',
  ]);
  const text = [
    "import { a } from '$lib/a';",
    "import b from './state/b.svelte';",
    "import Button from '$components/Button.svelte';",
    "import { invoke } from '@tauri-apps/api/core';",
    "import { x } from 'svelte';",
  ].join('\n');
  assert.deepEqual([...importsOf('ui/src/lib/c.ts', text, known)].sort(), [...known].sort());
});

test('test ids: literal, prefix and their match', () => {
  assert.deepEqual(definedIds('<Button testid="fetch" /> <div data-testid="row-{key}">'), [
    { id: 'fetch', prefix: false },
    { id: 'row-', prefix: true },
  ]);
  assert.deepEqual(usedIds("page.getByTestId('fetch'); page.getByTestId(`row-${k}`)"), [
    { id: 'fetch', prefix: false },
    { id: 'row-', prefix: true },
  ]);
  assert.ok(sameId({ id: 'row-a1', prefix: false }, { id: 'row-', prefix: true }));
  assert.ok(!sameId({ id: 'fetch', prefix: false }, { id: 'fetch-now', prefix: false }));
});

test('arguments', () => {
  assert.deepEqual(parseArgs(['--base', 'ui-preview', '--run']), {
    base: 'ui-preview',
    staged: false,
    run: true,
  });
  assert.deepEqual(parseArgs(['--staged']), { base: 'main', staged: true, run: false });
});

test('the real repo: the language sweep reaches every file, ui_contract the UI', () => {
  const real = collectFacts();
  assert.ok(real.tests.get('language').everything);
  assert.ok(real.tests.get('ui_contract').paths.includes('ui/src'));
  assert.ok(real.core.deps.has('matching'));
  assert.ok(real.ui.specs.length > 0);
});
