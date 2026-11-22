// Runs a Python script with the launcher of the OS: `py -3` on Windows (no `python` on PATH
// there by default), `python3` elsewhere. Used by `npm run regen` for tools/icon.py.
//
//     node tools/python.mjs <script.py> [args...]

import { spawnSync } from 'node:child_process';

const [command, ...prefix] = process.platform === 'win32' ? ['py', '-3'] : ['python3'];
const run = spawnSync(command, [...prefix, ...process.argv.slice(2)], { stdio: 'inherit' });
if (run.error) {
  console.error(`${command}: ${run.error.message}`);
  process.exit(1);
}
process.exit(run.status ?? 1);
