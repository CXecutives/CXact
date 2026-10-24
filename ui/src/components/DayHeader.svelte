<!--
  The heading of a day in the job list (the round 10 draft): "Heute", "Gestern", "Mi 23.09.",
  12/540 muted on the list's white, 14 above and 6 below, its text on the rows' inner edge.
  It sticks to the top of the list while the rows of its day scroll under it, above them and
  the selection, and its day's end pushes it out. Only the heading sticks: the day's wrapper
  around it stays unpositioned, so the rows measure from the list (RowBar).
-->
<script lang="ts">
  interface Props {
    label: string;
    testid?: string | null;
  }

  let { label, testid = null }: Props = $props();
</script>

<h3 class="day" data-testid={testid ?? undefined}>{label}</h3>

<style>
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
</style>
