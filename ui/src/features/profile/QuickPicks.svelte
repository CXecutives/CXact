<!--
  Quick picks under a field of the profile (Länder, Sprachen; user 2026-10-04): a row of
  quiet suggestion chips (Button `suggest`), "+" and a common value not chosen yet; a click
  takes it. The row shows only while it has a value. The look of "Häufig verlangt"
  (AskedTerms), without counts.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';

  interface Props {
    picks: readonly { id: string; label: string }[];
    testid: string;
    onpick: (id: string) => void;
  }

  let { picks, testid, onpick }: Props = $props();
</script>

{#if picks.length > 0}
  <ul class="picks" data-testid={testid}>
    {#each picks as pick (pick.id)}
      <li>
        <Button
          variant="suggest"
          icon="add"
          label={pick.label}
          testid="{testid}-{pick.id}"
          onclick={() => onpick(pick.id)}
        />
      </li>
    {/each}
  </ul>
{/if}

<style>
  .picks {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-6);
    min-width: 0;
  }
</style>
