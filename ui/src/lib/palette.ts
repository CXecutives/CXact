// The palette of the page (Einstellungen, Darstellung): `data-palette` on the root element,
// which ui/src/styles/tokens.css reads (Coast is its :root block, Light and Dark lay their
// values over it). Components never ask which palette is on. The backend stores the choice
// and dresses the window (its background and title bar); it sends the palette with every app
// state. A copy in localStorage lets the first frame after a start wear it already, before
// the app state arrives (a convenience of this web view only: the backend's is the choice).

import type { Palette } from './ipc/types';

const KEY = 'palette';
const PALETTES: readonly Palette[] = ['coast', 'light', 'dark'];

/** The page wears `palette` from the next frame on. */
export function applyPalette(palette: Palette): void {
  document.documentElement.dataset.palette = palette;
  try {
    localStorage.setItem(KEY, palette);
  } catch {
    // Without a store the app state brings the palette at the next start.
    return;
  }
}

/** The palette kept from the last session, Coast without one. */
function kept(): Palette {
  try {
    const value = localStorage.getItem(KEY);
    return PALETTES.find((palette) => palette === value) ?? 'coast';
  } catch {
    return 'coast';
  }
}

/** At start, before the first frame: the palette of the last session. */
export function restorePalette(): void {
  document.documentElement.dataset.palette = kept();
}
