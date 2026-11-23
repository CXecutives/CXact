// Writes docs/CODEMAP.md, the map a helper reads first instead of exploring the tree: one line
// per source file with its path, its length in lines, its purpose (the first sentence of its
// header comment) and its main public items, grouped by folder under the layer notes of
// docs/ARCHITECTURE.md, and the sections of docs/CHANGING.md. Generated from the code only:
// sorted, no dates, the same output on every checkout.
//
//     node tools/codemap.mjs           writes docs/CODEMAP.md
//     node tools/codemap.mjs --check   exits 1 when docs/CODEMAP.md is stale
//
// The check ignores the line counts (they move with every edit), so the map has to be
// written again only when a file, a purpose or a public item changes.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'docs/CODEMAP.md';

/** What the map lists, in this order (the layers of docs/ARCHITECTURE.md). */
const LAYERS = [
  { name: 'core', roots: ['core/src', 'core/tests', 'core/examples', 'core/build.rs'] },
  { name: 'src-tauri', roots: ['src-tauri/src', 'src-tauri/build.rs'] },
  { name: 'ui/src', roots: ['ui/src'] },
  { name: 'cv-worker', roots: ['cv-worker/src'] },
  { name: 'tools', roots: ['tools'] },
];
/** Never listed, never read: real data, recorded output, screenshots. */
const SKIP = ['core/tests/fixtures/', 'core/tests/snapshots/', 'tools/ui-harness/baselines/'];
const SOURCE = /\.(rs|ts|svelte|js|mjs|cjs|py|cmd|css)$/;
const MAX_PURPOSE = 60;
const MAX_ITEMS = 4;

const read = (path) => readFileSync(join(repo, path), 'utf8').replace(/\r\n/g, '\n');

/** Tracked and new files (git's ignore rules keep out builds, throwaways and private data). */
function sourceFiles() {
  const roots = LAYERS.flatMap((layer) => layer.roots);
  const out = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...roots],
    { cwd: repo, encoding: 'utf8' },
  );
  return [...new Set(out.split('\0'))]
    .filter((path) => path && SOURCE.test(path) && !SKIP.some((skip) => path.startsWith(skip)))
    .filter((path) => existsSync(join(repo, path)))
    .sort();
}

/* ---------------------------------------------------------------- header */

/** The leading comment of a file as text, or null. */
function headerComment(path, text) {
  const lines = text.split('\n');
  let i = 0;
  const skip = (test) => {
    while (i < lines.length && test(lines[i])) i++;
  };
  if (path.endsWith('.rs')) {
    skip((line) => /^\s*(#!?\[.*\])?\s*$/.test(line));
    const doc = [];
    for (; i < lines.length && /^\s*\/\/[!/]/.test(lines[i]); i++)
      doc.push(lines[i].replace(/^\s*\/\/[!/]\s?/, ''));
    return doc.length ? doc.join('\n') : null;
  }
  if (path.endsWith('.py')) {
    skip((line) => /^(#!|\s*$)/.test(line));
    const doc = /^[rbu]*("""|''')([\s\S]*?)\1/.exec(lines.slice(i).join('\n'));
    if (doc) return doc[2];
    const hashes = [];
    for (; i < lines.length && /^#/.test(lines[i]); i++) hashes.push(lines[i].replace(/^#\s?/, ''));
    return hashes.length ? hashes.join('\n') : null;
  }
  if (path.endsWith('.cmd')) {
    skip((line) => /^\s*(@echo off)?\s*$/i.test(line));
    const rems = [];
    for (; i < lines.length && /^\s*(rem\b|::)/i.test(lines[i]); i++)
      rems.push(lines[i].replace(/^\s*(rem|::)\s?/i, ''));
    return rems.length ? rems.join('\n') : null;
  }
  // TS, JS, Svelte, CSS: a leading //, /* */ or <!-- --> comment, the first one in <script>.
  skip((line) => /^(#!|\s*$|\s*<script[^>]*>\s*$)/.test(line));
  const rest = lines.slice(i).join('\n');
  const block = /^\s*(?:<!--([\s\S]*?)-->|\/\*([\s\S]*?)\*\/)/.exec(rest);
  if (block) return (block[1] ?? block[2]).replace(/^\s*\*? ?/gm, '');
  const slashes = [];
  for (; i < lines.length && /^\s*\/\//.test(lines[i]); i++) {
    if (/^\s*\/\/\s*(eslint|@ts-|prettier)/.test(lines[i])) continue;
    slashes.push(lines[i].replace(/^\s*\/\/\s?/, ''));
  }
  return slashes.length ? slashes.join('\n') : null;
}

/** The first sentence of a comment's first paragraph, on one line and capped. */
function firstSentence(comment) {
  const paragraph = comment
    .trim()
    .split(/\n\s*\n/)[0]
    .replace(/\[(`[^`\]]+`)\]/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const end = /(?<!\b(?:e\.g|i\.e|etc|vs))[.!?](?=\s|$)/.exec(paragraph);
  let sentence = end ? paragraph.slice(0, end.index + 1) : paragraph;
  // Asides in parentheses go first when the sentence is too long.
  for (let before = ''; sentence.length > MAX_PURPOSE && before !== sentence;) {
    before = sentence;
    sentence = sentence.replace(/ ?\([^()]*\)/, '');
  }
  return cap(sentence, MAX_PURPOSE);
}

function cap(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max / 2))}…`;
}

/* ----------------------------------------------------------------- items */

const RUST_ITEM =
  /^pub(?:\(crate\))?\s+(?:(?:const|async|unsafe)\s+)*(fn|struct|enum|trait|const|static|type|union)\s+([A-Za-z_]\w*)/;
const TS_EXPORT =
  /^export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;

/** The names a file offers to others, in source order (a component's name is its file's). */
function publicItems(path, text) {
  const names = [];
  const lines = text.split('\n');
  if (path.endsWith('.rs')) {
    for (const line of lines) {
      const item = RUST_ITEM.exec(line);
      if (item) names.push(item[2]);
      const reexport = /^pub use\s+([^;]+);/.exec(line);
      if (reexport) names.push(...useNames(reexport[1]));
    }
  } else if (/\.(ts|js|mjs|cjs|svelte)$/.test(path)) {
    const svelte = path.endsWith('.svelte');
    for (const raw of lines) {
      const line = svelte ? raw.trimStart() : raw;
      const item = TS_EXPORT.exec(line);
      if (item) names.push(item[1]);
      else if (/^export default\b/.test(line)) names.push('default');
      const list = /^export\s+(?:type\s+)?\{([^}]*)\}/.exec(line);
      if (list) names.push(...listNames(list[1]));
    }
  }
  // Constants (SCREAMING_CASE) after the types and functions.
  const constant = (name) => /^[A-Z][A-Z0-9_]+$/.test(name);
  const unique = [...new Set(names)].sort((a, b) => constant(a) - constant(b));
  const shown = unique.slice(0, MAX_ITEMS).join(', ');
  return unique.length > MAX_ITEMS ? `${shown} +${unique.length - MAX_ITEMS}` : shown;
}

/** `a::{B, c::D as E}` -> B, E; globs and `self` name nothing. */
function useNames(tree) {
  const inner = /\{([\s\S]*)\}\s*$/.exec(tree);
  const parts = inner ? inner[1].split(',') : [tree];
  return parts
    .map((part) =>
      part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        .split('::')
        .pop()
        .trim(),
    )
    .filter((name) => /^[A-Za-z_]\w*$/.test(name) && name !== 'self');
}

const listNames = (list) =>
  list
    .split(',')
    .map((part) =>
      part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        .replace(/^type\s+/, ''),
    )
    .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));

/* ----------------------------------------------------------- generated */

/** The generator a file names on its first line, or null for a hand-written file. */
function generator(text) {
  const first = text.split('\n', 1)[0];
  const named =
    /^\s*(?:\/\/!?|#|\/\*)\s*(?:This file was generated by|Generated by)\s+\[?([^\]\s(,]+)/i.exec(
      first,
    );
  return named ? named[1] : null;
}

/* ------------------------------------------------------------ the notes */

/** Folder notes from the "Layers" section of docs/ARCHITECTURE.md, by folder path. */
function layerNotes() {
  const notes = new Map();
  const path = 'docs/ARCHITECTURE.md';
  if (!existsSync(join(repo, path))) return notes;
  const section =
    read(path)
      .split(/^## /m)
      .find((part) => part.startsWith('Layers')) ?? '';
  const bullets = [];
  for (const line of section.split('\n').slice(1)) {
    const bullet = /^(\s*)- (.*)$/.exec(line);
    if (bullet) bullets.push({ indent: bullet[1].length, text: bullet[2] });
    else if (line.trim() && bullets.length) bullets.at(-1).text += ` ${line.trim()}`;
  }
  let root = '';
  const note = (key, text) => {
    const sentence = firstSentence(text);
    if (sentence && !/^[,;)]/.test(sentence) && !notes.has(key)) notes.set(key, sentence);
  };
  for (const { indent, text } of bullets) {
    const head =
      indent === 0
        ? /^\*\*`([^`]+)`\*\*[^:]*:\s*(.*)$/.exec(text)
        : /^`([^`]+\/)`:\s*(.*)$/.exec(text);
    if (!head) continue;
    const folder = head[1].replace(/\/$/, '');
    if (indent === 0) root = folder;
    const key = indent === 0 ? folder : posix.join(root, folder);
    note(key, head[2]);
    for (const [mention, rest] of mentions(head[2])) {
      for (const base of [root, `${root}/src`]) note(posix.join(base, mention), rest);
    }
  }
  return notes;
}

/** Each `folder/` of a text with the words after it, up to the next mention or sentence. */
function* mentions(text) {
  const token = /`([^`<>]+)\/`/g;
  for (let match; (match = token.exec(text));) {
    let depth = 0;
    let end = token.lastIndex;
    for (; end < text.length; end++) {
      const char = text[end];
      if (char === '(') depth++;
      if (char === ')') depth--;
      if (depth < 0) break;
      if (depth === 0 && /^(, `|\. |;)/.test(text.slice(end, end + 3))) break;
    }
    yield [match[1], text.slice(token.lastIndex, end).trim()];
  }
}

/** The headings of docs/CHANGING.md with their GitHub anchors. */
function changingSections() {
  const path = 'docs/CHANGING.md';
  if (!existsSync(join(repo, path))) return [];
  const seen = new Map();
  const out = [];
  let fence = false;
  for (const line of read(path).split('\n')) {
    if (line.startsWith('```')) fence = !fence;
    const heading = !fence && /^(#{2,3}) (.*)$/.exec(line);
    if (!heading) continue;
    let anchor = heading[2]
      .toLowerCase()
      .replace(/[^\p{L}\p{N} _-]/gu, '')
      .replace(/ /g, '-');
    const count = seen.get(anchor) ?? 0;
    seen.set(anchor, count + 1);
    if (count) anchor += `-${count}`;
    const indent = heading[1].length === 3 ? '  ' : '';
    out.push(`${indent}- [${heading[2]}](CHANGING.md#${anchor})`);
  }
  return out;
}

/* ------------------------------------------------------------------ map */

function render() {
  const files = sourceFiles();
  const notes = layerNotes();
  const within = (path, root) => path === root || path.startsWith(`${root}/`);
  let undocumented = 0;
  const body = [];
  for (const layer of LAYERS) {
    const byFolder = new Map();
    for (const path of files.filter((file) => layer.roots.some((root) => within(file, root)))) {
      const folder = posix.dirname(path);
      if (!byFolder.has(folder)) byFolder.set(folder, []);
      byFolder.get(folder).push(path);
    }
    if (!byFolder.size) continue;
    body.push('', `## ${layer.name}`);
    if (notes.has(layer.name)) body.push('', notes.get(layer.name));
    for (const folder of [...byFolder.keys()].sort()) {
      const paths = byFolder.get(folder);
      body.push('', `### ${folder}`);
      if (notes.has(folder) && folder !== layer.name) body.push(notes.get(folder));
      const texts = paths.map((path) => [path, read(path)]);
      const generators = texts.map(([, text]) => generator(text));
      if (generators.every(Boolean)) {
        const counts = new Map();
        for (const name of generators) counts.set(name, (counts.get(name) ?? 0) + 1);
        const by = [...counts]
          .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
          .map(([name, count]) => `${name} ${count}`)
          .join(', ');
        body.push(`- ${paths.length} generated files, never edited by hand (by ${by})`);
        continue;
      }
      for (const [path, text] of texts) {
        const comment = headerComment(path, text);
        if (!comment) undocumented++;
        const purpose = comment ? firstSentence(comment) : '(no header)';
        const items = publicItems(path, text);
        const lines = text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
        body.push(`- ${posix.basename(path)} ${lines} · ${purpose}${items ? ` · ${items}` : ''}`);
      }
    }
  }
  const changing = changingSections();
  return [
    '# Code map',
    '',
    'Generated by `node tools/codemap.mjs` from the code; never edited by hand (`--check` fails',
    'when it is stale). Read it first, then only the files the task needs. One line per source',
    'file: name, lines, purpose (the first sentence of its header comment), main public items',
    '(Rust `pub`, TS exports, Svelte props; `+n` more). The notes under the headings come from',
    'docs/ARCHITECTURE.md "Layers".',
    '',
    `${files.length} files, ${undocumented} of them without a header comment ("(no header)").`,
    ...(changing.length
      ? ['', '## Where a change goes', '', 'docs/CHANGING.md:', '', ...changing]
      : []),
    ...body,
    '',
  ].join('\n');
}

/** The map without its line counts, for the staleness check. */
const shape = (map) => map.replace(/^(- \S+) \d+ ·/gm, '$1 ·');

const map = render();
if (process.argv.includes('--check')) {
  const current = existsSync(join(repo, OUT)) ? read(OUT) : '';
  if (shape(current) !== shape(map)) {
    console.error(`${OUT} is stale: run \`node tools/codemap.mjs\` and commit it.`);
    process.exit(1);
  }
} else {
  writeFileSync(join(repo, OUT), map);
  console.log(`${OUT}: ${Buffer.byteLength(map)} bytes`);
}
