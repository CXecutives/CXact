<!--
  The reader while two or more jobs are chosen (like Mail and Outlook): how many, the titles
  of the first eight (then "+n"), and what can be done with all of them, with their words:
  the place's actions and the star (as in the list header's bar), "Als gelesen" while one
  of them is unread, "Details holen" when every one still lacks its full ad. One quiet line
  says how to choose.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import { displayTitle } from '$lib/i18n/format';
  import { t } from '$lib/i18n/t';
  import { commandKey } from '$lib/platform';
  import { keyOf } from '$lib/state/jobs.svelte';
  import { bulk } from './bulk.svelte';

  /** The titles the pane names; the others are counted. */
  const TITLES = 8;
  const named = $derived(bulk.chosen.slice(0, TITLES));
  const others = $derived(Math.max(0, bulk.chosen.length - TITLES));
</script>

<section
  class="pane"
  data-testid="selection-pane"
  aria-label={t.selection.chosen(bulk.chosen.length)}
>
  <h2 class="heading">{t.selection.chosen(bulk.chosen.length)}</h2>
  <ul class="titles" data-testid="selection-titles" data-copy>
    {#each named as job (keyOf(job.key))}
      <li class="title">{job.title ? displayTitle(job.title) : t.job.untitled}</li>
    {/each}
    {#if others > 0}<li class="more" data-testid="selection-more">
        {t.selection.more(others)}
      </li>{/if}
  </ul>
  <div class="actions" data-testid="selection-actions">
    {#each bulk.paneActions as action (action.label)}
      <Button
        variant="secondary"
        icon={action.icon}
        label={action.label}
        disabled={action.disabled ?? false}
        disabledReason={action.disabledReason ?? null}
        warns={action.warns ?? false}
        testid={action.testid ? action.testid.replace('selection-', 'pane-') : null}
        onclick={action.onclick}
      />
    {/each}
  </div>
  <p class="hint">{t.selection.hint(t.selection.commandKey[commandKey()])}</p>
</section>

<style>
  .pane {
    display: flex;
    flex-direction: column;
    gap: var(--space-16);
  }

  .heading {
    color: var(--text-heading);
    font: var(--type-lg);
  }

  /* The titles, one per line, cut at their end. */
  .titles {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
    color: var(--text);
    font: var(--type-body);
  }

  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .more {
    color: var(--text-muted);
    font-variant-numeric: var(--numeric);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-8);
  }

  .hint {
    color: var(--text-muted);
    font: var(--type-sm);
  }
</style>
