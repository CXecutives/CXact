// The live preview: the UI with the harness stub's demo data (no engine, no mails), served by
// Vite on one port, so every saved change shows at once. It serves the new UI from the UI
// worktree (.claude/worktrees/ui-preview) while that exists, else this checkout's ui/, and
// stays the same command after the two are connected. Started by tools/ui-preview.cmd (with
// --open: it opens the browser once it is ready) and by the `ui-preview` entry of
// .claude/launch.json. If the preview runs already (the port answers), it only opens the browser.
import { exec, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const port = 5178;
const page = '/?platform=windows';
const url = `http://localhost:${port}${page}`;
const open = process.argv.includes('--open');

const repo = fileURLToPath(new URL('..', import.meta.url));
const worktree = join(repo, '.claude', 'worktrees', 'ui-preview');
const root = existsSync(join(worktree, 'ui', 'vite.config.ts')) ? worktree : repo;

const openBrowser = () => {
  const command = { win32: 'start ""', darwin: 'open' }[process.platform] ?? 'xdg-open';
  exec(`${command} "${url}"`);
};

const running = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(1000) })
  .then(() => true)
  .catch(() => false);
if (running) {
  console.log(`The preview runs already: ${url}`);
  if (open) openBrowser();
  process.exit(0);
}

const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
if (!existsSync(vite)) execSync('npm ci', { cwd: root, stdio: 'inherit' });
console.log(`The preview serves ${join(root, 'ui')} on ${url}`);
console.log('Keep this window open; closing it stops the preview.');
// Vite's own command line, run in this process: `vite ui --mode harness` in that checkout.
process.chdir(root);
process.argv = [process.argv[0], vite, 'ui', '--mode', 'harness', '--port', String(port)];
process.argv.push('--strictPort', ...(open ? ['--open', page] : []));
await import(pathToFileURL(vite).href);
