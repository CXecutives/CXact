// Window width classes the layout reacts to in script (CSS uses the same breakpoints):
// below 1100 px the sidebar folds away (it floats over the view on demand), below 900 px the
// Jobs view is one column. The width itself is followed too (the list column's limits depend
// on it).
// Rechecked for round 10 (2026-10-24): at 1100 the docked sidebar (232) and its hairline (1)
// leave 867 px; the list's first width (440) leaves the job view 427, above --reader-min
// (420), and the list may grow to 447 there (the job view about 371 px inside its 28 px
// sides). A sidebar the user widened to its 300 leaves 799: the list then stands at 379, so
// the job view keeps its 420. Folded at 1099 the list keeps those 447 at most (cappedLimits),
// and at 900 the job view still has 460 beside a 440 list; below that one column.

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
