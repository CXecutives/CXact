/// <reference types="vite/client" />
// The states pages (harness build only, like the preview's menu; never in the app): `?states=
// controls` lays tools/ui-harness/pages/Controls.svelte over the app, a sheet of every control
// in each of its states (rest, hover, pressed, disabled, busy, error) to set beside the
// approved draft. A sibling page is one more file in pages/ (`?states=<its name>`), nothing
// to register. The page lies over the app below its menus and tooltips, so a select's list
// and a tooltip show as in the app. Hover and pressed are forced with `force` (pages/force.ts).

import { mount, type Component } from 'svelte';

const pages = import.meta.glob<Component>('./pages/*.svelte', { eager: true, import: 'default' });
const asked = new URLSearchParams(location.search).get('states')?.toLowerCase() ?? null;
const page =
  asked === null
    ? undefined
    : Object.entries(pages).find(([path]) => path.toLowerCase() === `./pages/${asked}.svelte`)?.[1];

// After the app's entry ran (tokens, motion and the input policy are installed then).
if (page !== undefined) setTimeout(() => mount(page, { target: document.body }), 0);
