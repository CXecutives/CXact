// The one tooltip of the app. The `tooltip` action writes here; the Tooltip component
// renders it. A native `title` is forbidden (unstyled, slow, sticks to the OS look).

export const TOOLTIP_ID = 'app-tooltip';

/** Moving from one tooltip to the next within this time shows the next one at once. */
const WARM_MS = 400;

class TooltipState {
  anchor = $state<HTMLElement | null>(null);
  text = $state('');
  /** When the last one went; none has at first, so the first one waits for its delay. */
  #hiddenAt = Number.NEGATIVE_INFINITY;
  #dismissed = 0;
  /** A click brought the bubble (an info symbol). */
  #clicked = false;

  get warm(): boolean {
    return this.anchor !== null || performance.now() - this.#hiddenAt < WARM_MS;
  }

  /** Counts the dismissals: a tooltip that waited for its delay while one came is never shown. */
  get dismissals(): number {
    return this.#dismissed;
  }

  /** The user asked for the bubble: a click brought it, or the keyboard's focus holds its anchor.
   *  It is then the layer on top, which Esc closes alone; one under a passing pointer only comes
   *  along. */
  get held(): boolean {
    if (this.anchor === null) return false;
    if (this.#clicked) return true;
    const focused = document.activeElement;
    return focused !== null && this.anchor.contains(focused) && focused.matches(':focus-visible');
  }

  /** A press or Esc: the bubble goes and every tooltip still waiting for its delay with it. */
  dismiss(): void {
    this.#dismissed += 1;
    this.hide();
  }

  show(anchor: HTMLElement, text: string, clicked = false): void {
    this.anchor = anchor;
    this.text = text;
    this.#clicked = clicked;
    anchor.setAttribute('aria-describedby', TOOLTIP_ID);
  }

  update(anchor: HTMLElement, text: string): void {
    if (this.anchor === anchor) this.text = text;
  }

  hide(anchor?: HTMLElement): void {
    if (this.anchor === null || (anchor !== undefined && anchor !== this.anchor)) return;
    this.anchor.removeAttribute('aria-describedby');
    this.anchor = null;
    this.#hiddenAt = performance.now();
  }
}

export const tooltipState = new TooltipState();
