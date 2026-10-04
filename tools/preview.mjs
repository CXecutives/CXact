// Serves the preview copy of the UI (.preview, built by `npm run preview:refresh` with the
// harness stub's demo data: no engine, no mails). The copy changes only when it is refreshed,
// so work in progress never breaks it. With --open it opens the app in a window of its own once
// it is ready (Microsoft Edge in app mode, no browser chrome; the default browser without
// Edge); if the preview runs already (port taken), it only opens the window.
import { exec, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../.preview/', import.meta.url));
const port = 5178;
const url = `http://127.0.0.1:${port}/?platform=windows`;
/** Edge where Windows installs it. */
const edge = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA]
  .filter(Boolean)
  .map((dir) => join(dir, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
  .find((path) => existsSync(path));
const openBrowser = () => {
  if (!process.argv.includes('--open')) return;
  if (edge === undefined) {
    exec(`start "" "${url}"`);
    return;
  }
  spawn(edge, [`--app=${url}`, '--window-size=1360,900'], {
    detached: true,
    stdio: 'ignore',
  }).unref();
};
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

const send = (res, type, body) => {
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
};

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = normalize(join(root, path === '/' ? 'index.html' : path));
  if (!file.startsWith(root)) return res.writeHead(403).end();
  try {
    send(res, types[extname(file)] ?? 'application/octet-stream', await readFile(file));
  } catch {
    send(res, types['.html'], await readFile(join(root, 'index.html')));
  }
});
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.log(`The preview runs already: ${url}`);
    openBrowser();
    setTimeout(() => process.exit(0), 1500);
    return;
  }
  throw error;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`The preview runs: ${url}`);
  console.log('Keep this window open; closing it stops the preview.');
  openBrowser();
});
