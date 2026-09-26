<!--
  The ad text with the passages of the match marked; the passages of a hovered reason are
  tinted (80 ms in, 150 ms out), the ones just jumped to flash navy once. Built from text
  nodes and <mark> elements only (no HTML from the page ever reaches the DOM). Offsets are
  UTF-16, as the browser counts. Where passages overlap, every character takes the most
  severe one (an exclusion over a check over a part fit over a gap over a fit; of two alike
  the earlier, then the longer), so the passage that excludes a job is never green. The text
  selects and copies like a document (`data-copy`).
  The link goes both ways: every passage names its state under the pointer (`hints`: "Erfüllt
  · Pflicht"), hovering it lights its reason (`onhover`) and a click scrolls to the reason
  (`onpick`); a click that ends a selection only selects.
-->
<script lang="ts" module>
  import type { Highlight, ReasonKind } from '$lib/ipc/types';

  export interface Segment {
    text: string;
    mark: Highlight | null;
  }

  /** How much a passage weighs where passages overlap. */
  const SEVERITY: Record<ReasonKind, number> = {
    violation: 4,
    check: 3,
    partial: 2,
    open: 1,
    met: 0,
  };

  /** Whether `a` wins over `b` on the characters both cover. */
  const beats = (a: Highlight, b: Highlight): boolean =>
    (SEVERITY[a.kind] - SEVERITY[b.kind] ||
      b.start - a.start ||
      a.end - a.start - (b.end - b.start)) > 0;

  /** The text cut at every passage's ends; each piece takes the passage that wins it. */
  export function segments(text: string, highlights: readonly Highlight[]): Segment[] {
    const marks = highlights.filter((h) => h.start < h.end && h.start >= 0 && h.end <= text.length);
    const cuts = [...new Set([0, text.length, ...marks.flatMap((h) => [h.start, h.end])])].sort(
      (a, b) => a - b,
    );
    const out: Segment[] = [];
    for (let index = 0; index + 1 < cuts.length; index += 1) {
      const from = cuts[index] ?? 0;
      const to = cuts[index + 1] ?? from;
      let mark: Highlight | null = null;
      for (const each of marks) {
        if (each.start <= from && each.end >= to && (mark === null || beats(each, mark))) {
          mark = each;
        }
      }
      const last = out.at(-1);
      if (last !== undefined && last.mark === mark) last.text += text.slice(from, to);
      else out.push({ text: text.slice(from, to), mark });
    }
    return out;
  }

  const NONE: ReadonlySet<string> = new Set();
</script>

<script lang="ts">
  import type { Action } from 'svelte/action';
  import { tooltip } from '$lib/actions/tooltip';

  interface Props {
    text: string;
    highlights: readonly Highlight[];
    /** Reasons whose passages are lit (a hovered or chosen reason). */
    active: ReadonlySet<string>;
    /** Reasons whose passages flash once (after a jump to them). */
    flash?: ReadonlySet<string>;
    /** What a passage is, under the pointer, by its reason. */
    hints?: ReadonlyMap<string, string>;
    /** The pointer enters (true) or leaves (false) a passage of this reason. */
    onhover?: ((reason: string, on: boolean) => void) | null;
    /** A left click on a passage of this reason. */
    onpick?: ((reason: string) => void) | null;
    element?: HTMLElement | null;
  }
  let {
    text,
    highlights,
    active,
    flash = NONE,
    hints = new Map(),
    onhover = null,
    onpick = null,
    element = $bindable(null),
  }: Props = $props();

  const parts = $derived(segments(text, highlights));

  const markOf = (target: EventTarget | null): HTMLElement | null =>
    target instanceof Element ? target.closest<HTMLElement>('mark[data-reason]') : null;

  /** One listener each for every passage: enter, leave and the click. */
  const passages: Action<HTMLElement> = (node) => {
    const over = (event: PointerEvent): void => {
      const mark = markOf(event.target);
      if (mark !== null && mark !== markOf(event.relatedTarget)) {
        onhover?.(mark.dataset.reason ?? '', true);
      }
    };
    const out = (event: PointerEvent): void => {
      const mark = markOf(event.target);
      if (mark !== null && mark !== markOf(event.relatedTarget)) {
        onhover?.(mark.dataset.reason ?? '', false);
      }
    };
    const click = (event: MouseEvent): void => {
      const mark = markOf(event.target);
      const selecting = getSelection()?.isCollapsed === false;
      if (event.button !== 0 || mark === null || selecting) return;
      onpick?.(mark.dataset.reason ?? '');
    };
    node.addEventListener('pointerover', over);
    node.addEventListener('pointerout', out);
    node.addEventListener('click', click);
    return {
      destroy: () => {
        node.removeEventListener('pointerover', over);
        node.removeEventListener('pointerout', out);
        node.removeEventListener('click', click);
      },
    };
  };
</script>

<div class="text" bind:this={element} data-testid="ad-text" data-copy use:passages>
  {#each parts as part, index (index)}{#if part.mark}<mark
        class="mark {part.mark.kind}"
        class:active={active.has(part.mark.reason)}
        class:flash={flash.has(part.mark.reason)}
        data-reason={part.mark.reason}
        use:tooltip={hints.get(part.mark.reason) ?? null}>{part.text}</mark
      >{:else}{part.text}{/if}{/each}
</div>

<style>
  .text {
    color: var(--text);
    font: var(--type-body);
    white-space: pre-line;
    overflow-wrap: anywhere;
  }

  .mark {
    border-radius: var(--radius-xs);
    background-color: transparent;
    color: inherit;
    text-decoration-line: underline;
    text-decoration-color: var(--border-strong);
    text-decoration-thickness: var(--focus-width);
    text-underline-offset: var(--space-4);
    transition: background-color var(--dur-base) var(--ease-standard);
  }

  .mark.active,
  .mark.flash {
    transition-duration: var(--dur-hover);
  }

  .met {
    text-decoration-color: var(--score-high-ring);
  }

  /* Met in part: amber, like its half circle; a point to check: navy, like its question
     mark (RD-06). */
  .partial {
    text-decoration-color: var(--warning);
  }

  .violation {
    text-decoration-color: var(--danger);
  }

  .check {
    text-decoration-color: var(--info);
  }

  .met.active {
    background-color: var(--score-high-surface);
  }

  .partial.active {
    background-color: var(--warning-soft);
  }

  .open.active {
    background-color: var(--surface-muted);
  }

  .violation.active {
    background-color: var(--danger-soft);
  }

  .check.active {
    background-color: var(--info-soft);
  }

  /* After a jump: the passage lights up in navy ("you are here") and settles. */
  .mark.flash {
    background-color: var(--border-navy);
  }
</style>
