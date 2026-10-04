<!-- A short word in a quiet grey pill (11/500): a requirement that is only nice to have.
     Static: a badge never reacts to the pointer. -->
<script lang="ts">
  interface Props {
    label: string;
  }

  let { label }: Props = $props();
</script>

<span class="badge">{label}</span>

<style>
  .badge {
    display: inline-flex;
    flex: none;
    align-items: center;
    height: var(--badge-height);
    padding: 0 var(--space-6);
    border-radius: var(--radius-full);
    background-color: var(--surface-muted);
    color: var(--text-muted);
    font: var(--type-xs);
    font-weight: var(--weight-medium);
    white-space: nowrap;
  }
</style>
