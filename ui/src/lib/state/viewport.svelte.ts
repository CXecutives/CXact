// Window width classes the layout reacts to in script (CSS uses the same breakpoints):
// below 1100 px the sidebar folds away (it floats over the view on demand), below 900 px the
// Jobs view is one column. The width itself is followed too (the list column's limits depend
// on it).

/** Below this width there is no room for the sidebar beside the view: it folds away. */
export const FOLD_BELOW = 1100;
const NARROW_BELOW = 900;

function query(width: number): MediaQueryList {
  return matchMedia(`(width < ${width}px)`);
}

class Viewport {
  /** Below 1100 px the sidebar folds away, whatever the user chose (like Claude's). */
  fold = $state(false);
  narrow = $state(false);
  /** The inner width of the window in px. */
  width = $state(innerWidth);

  constructor() {
    const fold = query(FOLD_BELOW);
    const narrow = query(NARROW_BELOW);
    this.fold = fold.matches;
    this.narrow = narrow.matches;
    fold.addEventListener('change', (event) => (this.fold = event.matches));
    narrow.addEventListener('change', (event) => (this.narrow = event.matches));
    addEventListener('resize', () => (this.width = innerWidth));
  }
}

export const viewport = new Viewport();
