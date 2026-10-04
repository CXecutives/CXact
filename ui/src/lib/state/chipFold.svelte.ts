// A long chip field folded to two lines (ChipInput `fold`, user 2026-10-04): while it has no
// focus it shows as many chips as its first two lines hold, one less for "+ n weitere"; the
// focus or a click on that button shows them all.

import { tick } from 'svelte';

export class ChipFold {
  /** The chips shown while folded (null: all). */
  at = $state<number | null>(null);
  /** "+ n weitere" opened the list. */
  opened = $state(false);
  #width = 0;
  readonly #on: () => boolean;

  constructor(on: () => boolean) {
    this.#on = on;
  }

  /** The chips to show. */
  visible(values: string[]): string[] {
    return this.#on() && !this.opened && this.at !== null ? values.slice(0, this.at) : values;
  }

  /** All chips laid out, then as many as the first two lines of `box` hold. */
  async measure(box: HTMLElement | null): Promise<void> {
    this.at = null;
    if (!this.#on() || this.opened) return;
    await tick();
    if (box === null) return;
    const chips = [...box.querySelectorAll<HTMLElement>('[data-chip]')];
    const tops = chips
      .map((chip) => chip.offsetTop)
      .filter((top, index, all) => all.indexOf(top) === index)
      .sort((a, b) => a - b);
    const second = tops[1];
    if (tops.length <= 2 || second === undefined) return;
    this.at = Math.max(1, chips.filter((chip) => chip.offsetTop <= second).length - 1);
  }

  /** Measures again when `box` changes its width; returns the clean-up. */
  observe(box: HTMLElement): () => void {
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry?.contentRect.width ?? 0);
      if (next === this.#width) return;
      this.#width = next;
      void this.measure(box);
    });
    observer.observe(box);
    return () => observer.disconnect();
  }
}
