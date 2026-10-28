<!--
  The heading of a day in the job list (the round 10 draft): "Heute", "Gestern", "Mi 23.09.",
  12/540 muted on the list's white, 14 above and 6 below, its text on the rows' inner edge.
  It sticks to the top of the list while the rows of its day scroll under it, above them and
  the selection, and its day's end pushes it out. While it sticks, the rows fade out under its
  lower edge (a short fade of the list's white, gone again once it stands in its place).
  Only the heading sticks: the day's wrapper around it stays unpositioned, so the rows measure
  from the list (RowBar).
-->
<script lang="ts">
  import { inView } from '$lib/actions/inView';

  interface Props {
    label: string;
    testid?: string | null;
  }

  let { label, testid = null }: Props = $props();

  /** Its place in the list has scrolled away over the top: it sticks there. */
  let stuck = $state(false);
</script>

<span class="place" aria-hidden="true" use:inView={(at) => (stuck = at === 'above')}></span>
<h3 class="day" class:stuck data-testid={testid ?? undefined}>{label}</h3>

<style>
  /* Where the heading stands in the list (no height): watched, it tells when it sticks. */
  .place {
    display: block;
    height: 0;
  }

  .day {
    position: sticky;
    z-index: var(--z-raised);
    top: 0;
    padding: var(--day-head-pad);
    background-color: var(--surface);
    color: var(--text-muted);
    font: var(--type-day);
    font-variant-numeric: var(--numeric);
    white-space: nowrap;
  }

  /* The fade under its lower edge, shown only while it sticks (in its place it would lie
     over its first row). */
  .day::after {
    position: absolute;
    top: 100%;
    right: 0;
    left: 0;
    height: var(--day-head-fade);
    background: var(--grad-fade);
    content: '';
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--dur-fast) var(--ease-standard);
  }

  .stuck::after {
    opacity: 1;
  }
</style>
