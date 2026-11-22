// The numbers the specs share with the app, read where the app defines them, so a changed
// token or a changed window size moves the specs with it (no px or ms copied into a spec):
// the tokens of ui/src/styles/tokens.css and the fold width of lib/state/viewport.svelte.ts.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const tokenSource = read('../../../ui/src/styles/tokens.css');

/** The first (light, base) definition of every custom property of tokens.css. */
const defined = new Map<string, string>();
for (const match of tokenSource.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) {
  if (!defined.has(match[1]!)) defined.set(match[1]!, match[2]!.trim());
}

/** A token's value as written, `var()` and a plain `calc(a * b)` resolved. */
export function token(name: string): string {
  const raw = defined.get(name);
  if (raw === undefined) throw new Error(`tokens.css has no ${name}`);
  return raw.replace(/var\((--[\w-]+)\)/g, (_, inner: string) => token(inner));
}

/** A token in px, as a number (`--control-field` is 30). */
export function px(name: string): number {
  const value = token(name);
  if (!/^-?[\d.]+px$/.test(value)) throw new Error(`${name} is ${value}, not a px value`);
  return Number.parseFloat(value);
}

/** A token as the computed style of the page reports it (`'15px'`, `'540'`). */
export const css = (name: string): string => token(name);

/** The px values of every token whose name starts with `prefix` (a ladder), sorted, once each. */
export function ladder(prefix: string): number[] {
  const values = [...defined.keys()]
    .filter((name) => name.startsWith(prefix))
    .map((name) => token(name))
    .filter((value) => /^[\d.]+px$/.test(value))
    .map((value) => Number.parseFloat(value));
  return [...new Set(values)].sort((a, b) => a - b);
}

/** The unitless values (weights) of every token whose name starts with `prefix`. */
export function numbers(prefix: string): number[] {
  const values = [...defined.keys()]
    .filter((name) => name.startsWith(prefix))
    .map((name) => token(name))
    .filter((value) => /^[\d.]+$/.test(value))
    .map(Number);
  return [...new Set(values)].sort((a, b) => a - b);
}

/** The window of the harness, and the page the layout specs lay out (the same width, a little less
 *  height for the bar of a real window). */
export const WINDOW = { width: 1360, height: 900 } as const;
export const PAGE = { width: 1360, height: 860 } as const;
/** The smallest window the app is made for (`src-tauri` minimum size). */
export const MIN_WINDOW = { width: 480, height: 360 } as const;

/** Below this width the sidebar folds away (lib/state/viewport.svelte.ts). */
export const FOLD_BELOW = Number(
  /FOLD_BELOW = (\d+)/.exec(read('../../../ui/src/lib/state/viewport.svelte.ts'))![1],
);
