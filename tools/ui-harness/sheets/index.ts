// Sheets of the design system's building blocks in their states, for the harness only
// (`?sheet=surfaces`): every block of a family side by side, at rest, in its states and with
// what it holds, to compare with the draft (docs/PLAN.md "Look") without clicking through the
// app. The stub (only in the harness build) installs it; the app never has it. A sheet lies
// over the app, which runs behind it as usual, so the app's toast stack and dialogs show
// above the sheet when it asks for them. A new sheet is one entry of SHEETS.

import { mount, type Component } from 'svelte';
import Surfaces from './Surfaces.svelte';

const SHEETS: Readonly<Record<string, Component>> = {
  surfaces: Surfaces,
};

/** The sheet the address names (`?sheet=`), over the app. */
export function installSheet(): void {
  const sheet = SHEETS[new URLSearchParams(location.search).get('sheet') ?? ''];
  if (sheet === undefined) return;
  const host = document.createElement('div');
  document.body.append(host);
  mount(sheet, { target: host, intro: false });
}
