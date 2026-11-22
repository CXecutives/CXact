// The contract of the new UI, synced from the backend's branch without connecting the two
// (CLAUDE.md "Change and connect"): this branch builds the UI against main's generated files,
// never against its own core's.
//
//   copied     ui/src/lib/ipc/types/** (commands.ts included), demo/vocabulary.json and
//              demo/ads.json (the demo ads and their expected roles are the engine's), as main has
//              them committed (`git show`)
//   computed   demo/snapshot.json: main's engine runs `core/tests/ui_demo_snapshot.rs` on main's
//              demo/ads.json and this branch's demo/profile.json, in a temporary detached worktree
//              of main that is removed afterwards
//   stamped    tools/contract-sync.json: main's commit and a hash of every synced file and of
//              the two demo inputs; tools/architecture.mjs (`npm run check`) fails while a file
//              differs from its stamp, so a hand edit or a run of this branch's own generators
//              (cargo test of its core) cannot quietly revert the contract
//
// The cargo build reuses the main clone's target folder (CXACT_SYNC_TARGET overrides it).
//
//     node tools/sync-contract.mjs [--dry] [--from <ref>] [--demo-from-main]
//       --dry             compute everything, write nothing, list what a sync would change
//       --from <ref>      the backend's branch or commit (default main)
//       --demo-from-main  take main's demo/profile.json as well (when main's profile format
//                         moved and this branch's demo profile no longer reads)

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The generated types, copied whole: a file main no longer has goes here too. */
export const TYPES = 'ui/src/lib/ipc/types/';
const DEMO = 'tools/ui-harness/demo/';
/** Copied as main committed them. */
const VOCABULARY = `${DEMO}vocabulary.json`;
/** The demo ads with their expected roles: main's, copied. */
const ADS = `${DEMO}ads.json`;
/** Computed by main's engine from the inputs. */
const SNAPSHOT = `${DEMO}snapshot.json`;
/** This branch's demo profile, the snapshot's other input: stamped, not copied. */
const INPUTS = [`${DEMO}profile.json`];
/** The stamp of the last sync. */
export const STAMP = 'tools/contract-sync.json';
const TEST = ['test', '-p', 'jobalert-core', '--test', 'ui_demo_snapshot'];

/** The hash of a file's content, line endings aside. */
const hash = (content) =>
  createHash('sha256')
    .update(content.toString('utf8').replace(/\r\n/g, '\n'))
    .digest('hex')
    .slice(0, 16);

function walk(root, dir, out = []) {
  if (!existsSync(join(root, dir))) return out;
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = posix.join(dir, entry.name);
    if (entry.isDirectory()) walk(root, path, out);
    else out.push(path);
  }
  return out;
}

/** The synced files of a checkout, sorted. */
const syncedFiles = (root) => [...walk(root, TYPES.slice(0, -1)), VOCABULARY, ADS, SNAPSHOT].sort();

const hashes = (root, paths) =>
  Object.fromEntries(
    paths
      .filter((p) => existsSync(join(root, p)))
      .map((p) => [p, hash(readFileSync(join(root, p)))]),
  );

/** What a checkout's synced files and inputs break of its stamp (empty: all as synced). */
export function stampProblems(root = repo) {
  if (!existsSync(join(root, STAMP))) return [`${STAMP} is missing`];
  const stamp = JSON.parse(readFileSync(join(root, STAMP), 'utf8'));
  const at = `${stamp.from} ${String(stamp.commit).slice(0, 8)}`;
  const problems = [];
  const compare = (stamped, paths, what) => {
    const now = hashes(root, paths);
    for (const path of new Set([...Object.keys(stamped), ...paths]))
      if (!(path in now)) problems.push(`${path}: gone since the sync of ${at}`);
      else if (!(path in stamped)) problems.push(`${path}: not from the sync of ${at}`);
      else if (now[path] !== stamped[path]) problems.push(`${path}: ${what} ${at}`);
  };
  compare(stamp.files ?? {}, syncedFiles(root), 'differs from the sync of');
  compare(stamp.inputs ?? {}, INPUTS, 'changed since the snapshot of');
  return problems;
}

/** Write the stamp of the files the checkout has now. */
export function writeStamp(root, from, commit) {
  const stamp = {
    generatedBy: 'tools/sync-contract.cmd, never edited by hand',
    from,
    commit,
    files: hashes(root, syncedFiles(root)),
    inputs: hashes(root, INPUTS),
  };
  writeFileSync(join(root, STAMP), `${JSON.stringify(stamp, null, 2)}\n`);
}

/* -------------------------------------------------------------------- sync */

function git(args, options = {}) {
  const result = spawnSync('git', args, { cwd: repo, maxBuffer: 1 << 28, ...options });
  if (result.status !== 0)
    throw new Error(`git ${args.join(' ')} failed:\n${result.stderr?.toString().trim()}`);
  return result.stdout;
}

/** The main clone's target folder: shared by every worktree, so main's deps are built. */
function targetDir() {
  if (process.env.CXACT_SYNC_TARGET) return resolve(process.env.CXACT_SYNC_TARGET);
  const common = resolve(repo, git(['rev-parse', '--git-common-dir']).toString().trim());
  return join(dirname(common), 'target');
}

/** Run main's snapshot test in `tree`: with `CXACT_REGEN` it writes the snapshot and passes; a
 *  main without it fails the run that rewrote the snapshot, which then runs again. */
function computeSnapshot(tree) {
  const env = {
    ...process.env,
    CARGO_TARGET_DIR: targetDir(),
    DEMO_DIR: join(tree, DEMO),
    CXACT_REGEN: '1',
  };
  for (const attempt of [1, 2]) {
    console.log(`cargo ${TEST.join(' ')} (main's engine, run ${attempt})`);
    const run = spawnSync('cargo', TEST, { cwd: tree, env, maxBuffer: 1 << 28 });
    if (run.status === 0) return readFileSync(join(tree, SNAPSHOT));
    // The test's own report is on stdout, cargo's build log on stderr.
    const report = `${run.stdout}`.trim() || `${run.stderr}`.trim();
    if (attempt === 1 && /regenerated|stale: rewritten/.test(report)) continue;
    const hint = /ProfileNot|profile/.test(report)
      ? `\n${INPUTS[0]} of this branch does not read on main: bring it to main's format, or --demo-from-main`
      : '';
    throw new Error(
      `main's snapshot test failed:\n${report.split('\n').slice(-30).join('\n')}${hint}`,
    );
  }
  throw new Error('unreachable');
}

function sync({ dry, from, demoFromMain }) {
  const commit = git(['rev-parse', '--verify', `${from}^{commit}`])
    .toString()
    .trim();
  const types = git(['ls-tree', '-r', '--name-only', commit, '--', TYPES])
    .toString()
    .split('\n')
    .filter(Boolean);
  if (!types.includes(`${TYPES}commands.ts`))
    throw new Error(`${from} has no ${TYPES}commands.ts: is it the backend's branch?`);
  console.log(`sync from ${from} ${commit.slice(0, 8)}${dry ? ' (dry: nothing is written)' : ''}`);

  const next = new Map();
  for (const path of [...types, VOCABULARY, ADS])
    next.set(path, git(['show', `${commit}:${path}`]));

  const tree = mkdtempSync(join(tmpdir(), 'cxact-sync-'));
  git(['worktree', 'add', '--detach', tree, commit], { stdio: ['ignore', 'ignore', 'pipe'] });
  const inputs = new Map();
  try {
    for (const path of INPUTS)
      if (demoFromMain) inputs.set(path, readFileSync(join(tree, path)));
      else copyFileSync(join(repo, path), join(tree, path));
    next.set(SNAPSHOT, computeSnapshot(tree));
  } finally {
    try {
      git(['worktree', 'remove', '--force', tree]);
    } catch (error) {
      console.error(`${error.message}\n(remove it with git worktree remove --force ${tree})`);
    }
    rmSync(tree, { recursive: true, force: true });
  }

  const current = new Set(syncedFiles(repo));
  const read = (path) => (existsSync(join(repo, path)) ? readFileSync(join(repo, path)) : null);
  const changes = [];
  for (const [path, content] of [...next, ...inputs]) {
    const old = read(path);
    if (old === null) changes.push(['added', path]);
    else if (hash(old) !== hash(content)) changes.push(['changed', path]);
  }
  for (const path of current) if (!next.has(path)) changes.push(['removed', path]);
  for (const [what, path] of changes) console.log(`  ${what.padEnd(8)}${path}`);
  console.log(`${changes.length} files ${dry ? 'would change' : 'changed'}`);
  if (dry) return;

  for (const [, path] of changes.filter(([what]) => what === 'removed'))
    unlinkSync(join(repo, path));
  for (const [path, content] of [...next, ...inputs]) writeFileSync(join(repo, path), content);
  writeStamp(repo, from, commit);
  console.log(`wrote ${STAMP}: commit the synced files with it`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--from');
  const unknown = args.filter(
    (arg, i) => !['--dry', '--demo-from-main', '--from'].includes(arg) && (at < 0 || i !== at + 1),
  );
  if (unknown.length || (at >= 0 && !args[at + 1])) {
    console.error('usage: node tools/sync-contract.mjs [--dry] [--from <ref>] [--demo-from-main]');
    process.exit(2);
  }
  try {
    sync({
      dry: args.includes('--dry'),
      from: at >= 0 ? args[at + 1] : 'main',
      demoFromMain: args.includes('--demo-from-main'),
    });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
