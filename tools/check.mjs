// `npm run check`: the six steps at the same time, each with its output kept until it ends, so a
// failure reads whole and the run lasts as long as the slowest step. eslint, stylelint and
// prettier keep a cache in node_modules/.cache (a second run reads only what changed); the
// type check has its own incremental state. Exits 1 when a step fails.
//
//     node tools/check.mjs [--no-cache]

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const cache = process.argv.includes('--no-cache')
  ? () => []
  : (tool, ...extra) => ['--cache', '--cache-location', `node_modules/.cache/${tool}`, ...extra];

const STEPS = {
  types: [
    ['svelte-check', '--workspace', 'ui', '--tsconfig', './tsconfig.json', '--fail-on-warnings'],
    ['tsc', '-p', 'tools/ui-harness/tsconfig.json'],
  ],
  eslint: [['eslint', '--max-warnings', '0', ...cache('eslint'), '.']],
  stylelint: [
    ['stylelint', '--max-warnings', '0', ...cache('stylelint'), 'ui/src/**/*.{css,svelte}'],
  ],
  format: [['prettier', '--check', ...cache('prettier', '--cache-strategy', 'content'), '.']],
  tokens: [['node', 'tools/tokens.mjs', '--check']],
  architecture: [['node', 'tools/architecture.mjs']],
};

/** An argument as one word in either shell (a glob stays for the tool to expand). */
const quote = (arg) => (/[*{}s]/.test(arg) ? `"${arg}"` : arg);

/** Run one command through npx (or node) and collect its output. */
function run(command) {
  return new Promise((resolve) => {
    const [bin, ...args] = command;
    const child =
      bin === 'node'
        ? spawn(process.execPath, args, { cwd: repo })
        : spawn(`npx --no-install ${bin} ${args.map(quote).join(' ')}`, { cwd: repo, shell: true });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('close', (code) => resolve({ code, output }));
  });
}

const started = Date.now();
const results = await Promise.all(
  Object.entries(STEPS).map(async ([name, commands]) => {
    const begun = Date.now();
    let output = '';
    let code = 0;
    // The commands of one step follow each other (the type check runs two).
    for (const command of commands) {
      const result = await run(command);
      output += result.output;
      if (result.code !== 0) {
        code = result.code ?? 1;
        break;
      }
    }
    return { name, code, output, seconds: (Date.now() - begun) / 1000 };
  }),
);

let failed = false;
for (const { name, code, output, seconds } of results) {
  console.log(`${code === 0 ? 'ok    ' : 'FAILED'} ${name} (${seconds.toFixed(1)} s)`);
  if (code !== 0) {
    failed = true;
    console.log(`\n${output.trim()}\n`);
  }
}
console.log(`check: ${((Date.now() - started) / 1000).toFixed(1)} s`);
process.exit(failed ? 1 : 0);
