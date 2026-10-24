<!--
  A row of suggestions under a field of the profile, one look for both kinds (the round 10
  draft): "Häufig verlangt" (the terms the jobs ask for, AskedTerms) and "Vorschlag" (the
  common countries not chosen yet, CountriesField). Its label 12 subtle, then the chips
  (Button `suggest`: a dashed edge, 26 high, 6 round, "+" and the value), wrapping where the
  field is narrow; no count, no tooltip. As the last line of a box of entries (`line`:
  Kompetenzen, Sprachen) it stands under a hairline, padded like the box's rows. A click takes the value; its chip goes and the others close
  the gap. The row shows only while it has a chip, unfolds when one comes and folds away with
  its last (a row that comes with its view is simply there). A focused chip that goes hands
  the focus to the chip now in its place, else the one before, else to its field (`home`).
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import { settled } from '$lib/motion/settled.svelte';
  import { fade, flip, unfold } from '$lib/motion/transitions';
  import { tick } from 'svelte';

  interface Pick {
    id: string;
    label: string;
  }

  interface Props {
    label: string;
    picks: readonly Pick[];
    /** The test id of the field's own control, which takes the focus after the last chip. */
    home: string;
    testid: string;
    /** The last line of a box of entries: a hairline above, the rows' sides. */
    line?: boolean;
    onpick: (id: string) => void;
  }

  let { label, picks, home, testid, line = false, onpick }: Props = $props();

  const id = $props.id();
  const motion = settled();
  let list = $state<HTMLElement | null>(null);

  async function pick(chosen: Pick, event: MouseEvent): Promise<void> {
    const button = event.currentTarget;
    const focused = button instanceof HTMLElement && button.contains(document.activeElement);
    const index = picks.indexOf(chosen);
    onpick(chosen.id);
    if (!focused) return;
    await tick();
    const next = picks[Math.min(index, picks.length - 1)];
    if (next !== undefined) {
      list?.querySelector<HTMLElement>(`[data-id="${CSS.escape(next.id)}"] button`)?.focus();
      return;
    }
    const own = document.querySelector<HTMLElement>(`[data-testid="${home}"]`);
    (own?.matches('input, button') ? own : own?.querySelector<HTMLElement>('input'))?.focus();
  }
</script>

{#if picks.length > 0}
  <div class="frame" class:line data-testid={testid} transition:unfold={{ on: motion.ready }}>
    <div class="row">
      <span class="label" id="{id}-label">{label}</span>
      <ul class="picks" aria-labelledby="{id}-label" bind:this={list}>
        {#each picks as each (each.id)}
          <li
            data-testid="{testid}-term"
            data-id={each.id}
            data-term={each.label}
            animate:flip
            out:fade={{ on: motion.ready }}
          >
            <Button
              variant="suggest"
              icon="add"
              label={each.label}
              testid="{testid}-add"
              onclick={(event) => void pick(each, event)}
            />
          </li>
        {/each}
      </ul>
    </div>
  </div>
{/if}

<style>
  /* The label, then the chips, all on the field's left edge and wrapping under each other. */
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-6);
    min-width: 0;
  }

  .line {
    border-top: var(--border-width) solid var(--border);
  }

  .line .row {
    padding: var(--suggest-line-pad-y) var(--card-pad-x);
  }

  .label {
    margin-right: var(--space-2);
    color: var(--text-subtle);
    font: var(--type-xs);
  }

  .picks {
    display: contents;
  }
</style>
