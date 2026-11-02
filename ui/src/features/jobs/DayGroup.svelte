<!--
  The rows of one day of the job list under its heading (DayHeader: "Heute", "Gestern", "Mi
  23.09."), or the rows of a section without days (the flat orders, "Noch nicht bewertet",
  "Ausgeschlossen": no heading). A hairline above each row but the first, from the title (52)
  to 10 before the row's end, hidden next to the row under the pointer, next to the row of an
  open menu, which looks like it, and next to the open one (the highlight stands there). A row the user moves out folds its height away; the day
  folds with its last row, heading and all; an undo brings them back the same way, unfolding,
  so everything below glides there and back. When a list opens, its first rows rise into place
  one after the other (lib/motion enterList; `opening`, at most the first --stagger-max). The
  day's wrapper stays unpositioned: only its heading sticks, and the rows measure from the
  list (RowBar).
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import DayHeader from '$components/DayHeader.svelte';
  import type { JobView } from '$lib/ipc/types';
  import { enterList } from '$lib/motion/enter';
  import { staggerLimit } from '$lib/motion/motion';
  import { rowCollapse, unfold } from '$lib/motion/transitions';
  import { keyOf } from '$lib/state/jobRows';
  import { moving, returning } from './actions';

  interface Props {
    /** The day's heading (null: a section without days). */
    label?: string | null;
    /** Its rows, in the list's order. */
    jobs: readonly JobView[];
    /** The place of its first row in the list (the stagger counts across the days). */
    start?: number;
    /** The open job's row (its key). */
    open: string | null;
    /** The list opens: its first rows rise in. */
    opening?: boolean;
    /** One row: the job, whether it is open, and whether it opens with the list (its ring
     *  counts up). */
    row: Snippet<[JobView, boolean, boolean]>;
    testid?: string | null;
  }

  let {
    label = null,
    jobs,
    start = 0,
    open,
    opening = false,
    row,
    testid = null,
  }: Props = $props();

  /** Every row of the day folds away: the day folds with them. */
  const folding = $derived(jobs.length > 0 && jobs.every((job) => moving.has(keyOf(job.key))));
</script>

<div
  class="day"
  data-testid={testid ?? undefined}
  in:unfold={{ on: jobs.length > 0 && jobs.every((job) => returning.has(keyOf(job.key))) }}
  out:rowCollapse={{ on: folding }}
>
  {#if label !== null}<DayHeader {label} testid="day-heading" />{/if}
  {#each jobs as job, index (keyOf(job.key))}
    {@const key = keyOf(job.key)}
    {@const rises = opening && start + index < staggerLimit()}
    <div
      class="item"
      data-key={key}
      data-open={key === open ? '' : undefined}
      data-rests=""
      in:unfold={{ on: returning.has(key) }}
      out:rowCollapse={{ on: moving.has(key) }}
      use:enterList={{ index: start + index, on: rises }}
    >
      {@render row(job, key === open, rises)}
    </div>
  {/each}
</div>

<style>
  .day {
    display: block;
  }

  .item {
    position: relative;
  }

  /* The hairline above a row, from the title on; none above the first of a day or section. */
  .item + .item::before {
    position: absolute;
    top: 0;
    right: var(--list-rule-end);
    left: var(--row-rule-start);
    border-top: var(--border-width) solid var(--border);
    content: '';
    pointer-events: none;
  }

  /* Next to the row under the pointer, the row of an open menu and the open one: no line. */
  .item:hover:where(:not([data-still]))::before,
  .item:hover:where(:not([data-still])) + .item::before,
  .item:has(:global(.menued))::before,
  .item:has(:global(.menued)) + .item::before,
  .item[data-open]::before,
  .item[data-open] + .item::before {
    opacity: 0;
  }
</style>
