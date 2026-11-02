// The hold on hover: where the pointer stood when what lay under it was replaced (a row's tool
// took its row away and the next one slid under the pointer, the button that was pressed gave
// way to the next job's). Until the pointer moves, no element counts as hovered by it: the next
// row shows no tools and the next button no tooltip under a pointer that did not move
// (input.ts `hover`, lib/actions/tooltip.ts). And which press of a pair a click is (`secondPress`).
//
// No listener and no import, on purpose: the tooltip action, which every button carries, reads
// these, and input.ts (which reaches the whole IPC layer) must not be pulled in that early.

/**
 * The second press of a pair: the engine counts on (1, 2, 3, ...) while the presses keep the OS's
 * double-click time at one spot, so every even one is a second one and the next a new first; a
 * keyboard's click counts 0 and presses.
 */
export const secondPress = (event: MouseEvent): boolean =>
  event.detail > 0 && event.detail % 2 === 0;

/** Where the pointer stood when the hold began (null: no hold). */
let heldAt: { x: number; y: number } | null = null;

/** The pointer rests here until it moves: nothing that slides under it counts as hovered. */
export function holdHover(event: MouseEvent): void {
  heldAt = { x: event.clientX, y: event.clientY };
}

/** The pointer moved since the hold (which then ends); the engines send `pointerenter` and
 *  `pointermove` at the old place when content slides under a pointer that rests. Less than
 *  a pixel is no move: a click reports whole pixels, a pointer event the fraction too. Every
 *  move of the pointer in the window asks (input.ts), so the hold never outlives the pointer's
 *  leaving the place it was pressed at. */
export function pointerMoved(event: PointerEvent): boolean {
  if (heldAt === null) return true;
  if (Math.abs(event.clientX - heldAt.x) < 1 && Math.abs(event.clientY - heldAt.y) < 1) {
    return false;
  }
  heldAt = null;
  return true;
}
