// The gate at the end of a block: `cargo fmt --all --check` first, then the cargo steps (one
// after another, they share the build folder) beside `npm run check` and the node checks, then
// the Playwright specs alone (a browser beside a build would slow its timed steps). One line
// per step with its status and time; a failed step shows the last 30 lines of its output, the
// whole output is in target/gate/. Exits 1 when a step failed. Run no dev server beside it.
//
//     node tools/gate.mjs                 the checks the change needs (tools/affected.mjs)
//     node tools/gate.mjs --all           the same with clippy over the whole workspace
//     node tools/gate.mjs --full          fmt, clippy, cargo test --workspace, npm run check,
//                                         the code map and the tools' own tests
//     node tools/gate.mjs --base <ref>    the change since the merge base with <ref>
//     node tools/gate.mjs --staged        the staged change only

import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { affectedCommands, parseArgs } from './affected.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOGS = join(repo, 'target', 'gate');
const FMT = 'cargo fmt --all --check';
const CLIPPY_ALL = 'cargo clippy --workspace --all-targets -- -D warnings';
const TAIL = 30;

/** The steps of this run, in their order. */
function steps(argv) {
  if (argv.includes('--full')) {
    const tests = readdirSync(join(repo, 'tools')).filter((name) => name.endsWith('.test.mjs'));
    return [
      FMT,
      CLIPPY_ALL,
      'cargo test --workspace',
      'npm run check',
      'node tools/codemap.mjs --check',
      ...(tests.length ? [`node --test ${tests.map((name) => `tools/${name}`).join(' ')}`] : []),
    ];
  }
  let lines = affectedCommands(parseArgs(argv)).filter((line) => line !== FMT);
  if (argv.includes('--all'))
    lines = [CLIPPY_ALL, ...lines.filter((line) => !line.startsWith('cargo clippy'))];
  return [FMT, ...lines];
}

/** Runs one command, its output kept; resolves to `{ command, ok, seconds, output }`. */
function runStep(command, index) {
  const started = Date.now();
  const output = [];
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: repo,
      shell: true,
      env: { ...process.env, CARGO_TERM_COLOR: 'never', FORCE_COLOR: '0' },
    });
    child.stdout.on('data', (chunk) => output.push(chunk));
    child.stderr.on('data', (chunk) => output.push(chunk));
    let done = false;
    const finish = (ok, extra = '') => {
      if (done) return;
      done = true;
      const text = Buffer.concat(output).toString('utf8').replace(/\r\n/g, '\n') + extra;
      const name = command
        .split(' ')
        .slice(0, 3)
        .join('-')
        .replace(/[^\w.-]+/g, '-');
      const log = join(LOGS, `${index + 1}-${name}.log`);
      writeFileSync(log, text);
      const step = { command, ok, seconds: (Date.now() - started) / 1000, output: text, log };
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${step.seconds.toFixed(1).padStart(6)}s  ${command}`);
      resolve(step);
    };
    child.on('error', (error) => finish(false, `\n${error.message}\n`));
    child.on('close', (code) => finish(code === 0));
  });
}

/** Runs the commands one after another. */
async function lane(commands, offset) {
  const results = [];
  for (const [i, command] of commands.entries()) results.push(await runStep(command, offset + i));
  return results;
}

async function main() {
  const all = steps(process.argv.slice(2));
  mkdirSync(LOGS, { recursive: true });
  const started = Date.now();
  const cargo = all.filter((line) => line.startsWith('cargo ') && line !== FMT);
  const npm = all.filter((line) => line === 'npm run check' || line.startsWith('node '));
  const browser = all.filter(
    (line) => !cargo.includes(line) && !npm.includes(line) && line !== FMT,
  );
  const results = [await runStep(FMT, 0)];
  const parallel = await Promise.all([lane(cargo, 1), lane(npm, 1 + cargo.length)]);
  results.push(...parallel.flat(), ...(await lane(browser, 1 + cargo.length + npm.length)));
  const failed = results.filter((step) => !step.ok);
  for (const step of failed) {
    const lines = step.output.trimEnd().split('\n');
    console.log(`\n--- ${step.command} (last ${TAIL} lines, all of it in ${step.log})`);
    console.log(lines.slice(-TAIL).join('\n'));
  }
  const total = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    failed.length
      ? `\ngate: ${failed.length} of ${results.length} steps failed (${total}s)`
      : `\ngate: ${results.length} steps passed (${total}s)`,
  );
  process.exit(failed.length ? 1 : 0);
}

await main();
