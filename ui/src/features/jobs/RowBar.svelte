<!--
  The job list's one highlight (the round 10 draft): the open job's row on a soft coral tint
  (8 round, the row's own box), a 3 px coral bar at its left
  edge, 10 in from its top and bottom. It lies under the rows and the days' headings, as the first
  child of what holds them (it comes and goes with the rows, and what moves that block moves it),
  so it scrolls with the rows. Opening another job glides it there
  by its translateY (180 ms, ease-out, like the sidebar's pill); a
  target out of sight, fast browsing (pace.ts: the arrow keys held, opens close together) and
  far jumps place it. It stays with its row whatever moves the rows: at once when rows arrive
  or fold away above it, gliding along when the list re-sorts. It is the height of its row
  from the start, also of a row an undo unfolds under it. It is simply there the first
  time: when the list is built or comes back, and after a reload, another filter or a search.
  Opening a job while none is open fades it in, closing fades it out. A job that leaves the
  list (archive, Papierkorb) keeps it where its row was until the next job opens there: it
  waits there while the next row rises into that place, however long the fold takes. A list
  without rows has none: it goes with them at once. It
  greys while the window is inactive, like Mail and Explorer. Under reduced motion it never
  moves.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { px, setVars, type CssVars } from '$lib/actions/cssVars';
  import { play } from '$lib/motion/motion';
  import { browsingFast } from '$lib/motion/pace';
  import type { BarBox } from '$lib/motion/transitions';

  interface Props {
    /** The row it marks: the open job's, while it shows as selected. */
    open: string | null;
    /** The listed rows: a row on the page that is not listed is on its way out. */
    listed: ReadonlySet<string>;
    /** Rows that fold away: their height leaves the list while they do. */
    folding: ReadonlySet<string>;
    /** Counts the lists: another list places it without motion. */
    generation: number;
  }

  let { open, listed, folding, generation }: Props = $props();

  let bar = $state<HTMLElement | null>(null);
  /** What holds the rows (elements with `data-key`) and the bar; their layout moves it. */
  const rows = $derived(bar?.parentElement ?? null);
  let shown = $state(false);
  /** This change of `shown` goes without a fade. */
  let snap = $state(false);
  let snapFrame = 0;

  /** The row the bar stands at (null: hidden). */
  let at: string | null = null;
  /** Where its style puts it. */
  let placed: BarBox | null = null;
  let vars: CssVars = {};
  /** The move under way: a slide to another row, or a glide with its row. */
  let motion: { animation: Animation; from: BarBox; to: BarBox } | null = null;
  /** The next placement jumps there: no slide, no fade. */
  let jump = true;
  /** It stands where its row ends up once the rows folding away above it are gone, ahead of
   *  the row, which rises in as they fold (the next job after an archive opened there). */
  let ahead = false;
  /** The props as the last update saw them. */
  let seen: { open: string | null; generation: number } = {
    open: null,
    generation: Number.NaN,
  };
  /** The row found last (a lookup among thousands of rows only when it changed). */
  let found: HTMLElement | null = null;

  function find(key: string): HTMLElement | null {
    if (found?.isConnected && found.dataset['key'] === key && rows?.contains(found)) return found;
    found = rows?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`) ?? null;
    return found;
  }

  /** The row's box: its top in what holds the rows (summed along the offset parents: a day's
   *  wrapper stays unpositioned, a row's own wrapper is) and its whole height, also while it
   *  unfolds. */
  function boxOf(item: HTMLElement): BarBox {
    let top = 0;
    for (let node: Element | null = item; node instanceof HTMLElement && node !== rows;) {
      top += node.offsetTop;
      node = node.offsetParent;
    }
    return { top, height: item.scrollHeight };
  }

  /** Where the row will stand once the rows folding away above it are gone. */
  function settledBox(item: HTMLElement, live: BarBox): BarBox {
    let top = live.top;
    for (const key of folding) {
      if (listed.has(key)) continue;
      const other = rows?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
      if (!other || other === item) continue;
      if (other.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING) {
        top -= other.offsetHeight;
      }
    }
    return { top, height: live.height };
  }

  function inMotion(): boolean {
    return motion !== null && motion.animation.playState === 'running';
  }

  /** Where the bar is seen now (on its way, if it moves). */
  function current(): BarBox | null {
    if (motion === null || motion.animation.playState !== 'running') return placed;
    const { from, to, animation } = motion;
    const progress = animation.effect?.getComputedTiming().progress ?? 1;
    const along = (a: number, b: number): number => a + (b - a) * progress;
    return { top: along(from.top, to.top), height: along(from.height, to.height) };
  }

  function stop(): void {
    motion?.animation.cancel();
    motion = null;
  }

  function place(box: BarBox): void {
    if (bar === null) return;
    const next = { 'bar-top': px(box.top), 'bar-height': px(box.height) };
    setVars(bar, next, vars);
    vars = next;
    placed = box;
  }

  /**
   * The style holds `to`; the move starts from `from`: 180 ms ease-out, to another row (the
   * one glide of a choice) as along with a row that glides to its new place (the same
   * timing). Its height moves only where the two rows differ (rows are one height).
   */
  function slide(from: BarBox, to: BarBox): void {
    stop();
    place(to);
    if (bar === null) return;
    const sized = px(from.height) !== px(to.height);
    const at = (box: BarBox): { transform: string; height?: string } => ({
      transform: `translateY(${Math.round(box.top)}px)`,
      ...(sized ? { height: px(box.height) } : {}),
    });
    const animation = play(bar, [at(from), at(to)], { duration: 'slow', easing: 'out' });
    animation?.addEventListener('finish', () => animation.cancel());
    motion = animation === null ? null : { animation, from, to };
  }

  /** The next change of `shown` goes at once (for one frame). */
  function noFade(): void {
    snap = true;
    cancelAnimationFrame(snapFrame);
    snapFrame = requestAnimationFrame(() => (snap = false));
  }

  function reveal(fade: boolean): void {
    if (shown) return;
    if (!fade) noFade();
    shown = true;
  }

  function conceal(fade: boolean): void {
    at = null;
    stop();
    if (!shown) return;
    if (!fade) noFade();
    shown = false;
  }

  /** Brings the bar to the row it marks: after a change of the open job or of the list, and
   *  whenever the rows' layout changed (before it is drawn, so it never lags behind its
   *  row). */
  function update(): void {
    if (bar === null) return;
    const before = seen;
    seen = { open, generation };
    if (generation !== before.generation) jump = true;
    // The user opened another job, or closed it.
    const changed = open !== before.open;
    if (open === null) {
      conceal(changed && !jump);
      return;
    }
    const item = find(open);
    if (item === null) {
      // Its row folded away already: the bar waits there for the next job.
      if (at === open && folding.has(open)) return;
      // Not mounted (further down than the rows shown so far) or not in this list.
      conceal(false);
      jump = true;
      return;
    }
    // The list is hidden (one column, reading): it is placed when the list shows again.
    if (item.offsetParent === null) {
      jump = true;
      return;
    }
    // Its row folds away (archived, deleted): the bar stays until the next job opens.
    if (!listed.has(open)) return;
    const live = boxOf(item);
    if (at !== open) {
      const to = settledBox(item, live);
      const from = shown ? current() : null;
      at = open;
      ahead = to.top !== live.top;
      const near = from !== null && Math.abs(to.top - from.top) < innerHeight;
      if (from !== null && near && changed && !jump && !browsingFast()) {
        slide(from, to);
      } else {
        stop();
        place(to);
        reveal(changed && !jump);
      }
      jump = false;
      return;
    }
    if (inMotion() && motion !== null) {
      // The rows moved while it slides: on to where the row now ends up.
      const to = settledBox(item, live);
      ahead = to.top !== live.top;
      const from = current();
      if (
        from !== null &&
        (px(to.top) !== px(motion.to.top) || px(to.height) !== px(motion.to.height))
      ) {
        slide(from, to);
      }
      return;
    }
    motion = null;
    // Ahead of its row it waits until the row has risen in: on a busy machine the fold ends
    // well after the slide, and the bar must not drop onto the row on its way.
    const to = ahead ? settledBox(item, live) : live;
    ahead = to.top !== live.top;
    place(to);
    reveal(false);
    jump = false;
  }

  /** The open row glides by `offset` to its new place (the list re-sorted): the bar glides
   *  along in the row's timing. */
  export function shift(offset: number): void {
    update();
    if (placed === null || !shown || at === null || inMotion()) return;
    slide({ top: placed.top + offset, height: placed.height }, placed);
  }

  /** Reports the rows' layout, right after each layout that changed their size. */
  let observer: ResizeObserver | null = null;

  $effect(() => {
    const root = rows;
    if (root === null) return;
    const watch = new ResizeObserver(() => update());
    watch.observe(root);
    observer = watch;
    return () => {
      watch.disconnect();
      if (observer === watch) observer = null;
    };
  });

  /**
   * An update after the next layout, before that frame is drawn: observed anew, the rows are
   * reported once more (in this very frame when they changed while it is being prepared, as
   * rows built in a frame callback do). A frame callback covers a list without a box (hidden
   * in one column), which reports nothing.
   */
  function soon(): () => void {
    if (observer !== null && rows !== null) {
      observer.unobserve(rows);
      observer.observe(rows);
    }
    const frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }

  // Another job opened in the same list: at once, so the bar sets off with the rows' wash.
  // Any other change of the list once its rows are laid out.
  $effect(() => {
    void open;
    void generation;
    void listed;
    if (untrack(() => open !== seen.open && generation === seen.generation)) {
      untrack(update);
      return;
    }
    return untrack(soon);
  });

  $effect(() => () => {
    stop();
    cancelAnimationFrame(snapFrame);
  });
</script>

<span
  class="highlight"
  class:shown
  class:snap
  aria-hidden="true"
  data-testid="row-bar"
  bind:this={bar}
></span>

<style>
  /* Placed by script (--bar-top, --bar-height), shown by opacity (140 ms). Under the rows: the
     first child of what holds them, and nothing of it takes a z-index. */
  .highlight {
    position: absolute;
    top: 0;
    right: var(--list-rows-inset-end);
    left: var(--list-rows-inset);
    height: var(--bar-height, 0);
    border-radius: var(--list-row-radius);
    background-color: var(--selection-tint);
    opacity: 0;
    pointer-events: none;
    transition:
      opacity var(--dur-fade) var(--ease-in),
      background-color var(--dur-base) var(--ease-standard);
  }

  /* The coral bar at its left edge, 10 in from its top and bottom. */
  .highlight::before {
    position: absolute;
    top: var(--row-bar-inset);
    bottom: var(--row-bar-inset);
    left: 0;
    width: var(--row-bar);
    border-radius: var(--row-bar);
    background-color: var(--selection-bar);
    content: '';
    transition: background-color var(--dur-base) var(--ease-standard);
  }

  /* Faded out it stands at the list's top: where it stood, it would keep the scroll area long. */
  .highlight:not(.shown) {
    transform: none;
    transition:
      opacity var(--dur-fade) var(--ease-in),
      background-color var(--dur-base) var(--ease-standard),
      transform var(--dur-instant) var(--ease-standard) var(--dur-fade);
  }

  .shown {
    opacity: 1;
    transform: translateY(var(--bar-top, 0));
    transition-timing-function: var(--ease-out), var(--ease-standard);
  }

  .snap {
    transition: none;
  }

  /* Like Mail and Explorer: the selection greys out while the window is in the back. */
  :global(:root[data-window='inactive']) .highlight {
    background-color: var(--surface-selected-inactive);
  }

  :global(:root[data-window='inactive']) .highlight::before {
    background-color: var(--text-muted);
  }
</style>
