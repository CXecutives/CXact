<!--
  "Häufig verlangt" under the competences: the terms the jobs of the last 30 days ask for most
  that the profile does not name (`asked_terms`: "Anaplan" of "Kenntnisse in Anaplan"), a calm
  list between hairlines like the settings rows, one row per term: the term (to copy), quietly
  the field of the profile it belongs to (Werkzeug, Branche, Kompetenz, Sprache ...), how many
  jobs ask for it, and "Hinzufügen" at the right. "Hinzufügen" puts the term into its field of
  the form, an unsaved change like any other (the save bar comes); its row folds away, and so
  does a term the form names already in any field. The block shows only while it has a term,
  unfolds when it comes and folds away when it goes; it asks again after every save (a new
  stored profile) and every finished run (a fetch, the rescore after a save). A focused
  "Hinzufügen" that goes hands the focus to the next one, else to "Kompetenz hinzufügen".
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import { tooltip } from '$lib/actions/tooltip';
  import { t } from '$lib/i18n/t';
  import { invoke } from '$lib/ipc/api';
  import type { AskedTerm } from '$lib/ipc/types';
  import { settled } from '$lib/motion/settled.svelte';
  import { flip, rowCollapse, unfold } from '$lib/motion/transitions';
  import { app } from '$lib/state/app.svelte';
  import { editor } from '$lib/state/profile.svelte';
  import { putTerm, termsOf } from '$lib/state/terms';
  import { run } from '$lib/state/run.svelte';
  import { onMount, tick, untrack } from 'svelte';

  const id = $props.id();
  // The answer that comes while the view is being built is simply there; a block or a row
  // that comes or goes later (a save, a fetch, "Hinzufügen") unfolds or folds.
  const motion = settled();
  let asked = $state<AskedTerm[]>([]);
  let list = $state<HTMLElement | null>(null);

  /** A term for comparing, as core compares them: lower case, its words without the
   *  punctuation between them ("Power-BI" is "power bi"; `+` and `#` belong to a word). */
  const key = (term: string): string =>
    term
      .toLowerCase()
      .split(/[^\p{L}\p{N}+#]+/u)
      .filter((word) => word !== '')
      .join(' ');

  /** What the form names already, in any field. */
  const known = $derived(new Set(termsOf(editor.after).map(key)));
  const shown = $derived(asked.filter((term) => !known.has(key(term.term))));

  /** The latest question wins: an older answer that comes late is dropped. */
  let asking = 0;
  async function load(): Promise<void> {
    const mine = ++asking;
    try {
      const answer = await invoke('asked_terms', {});
      if (mine === asking) asked = answer;
    } catch {
      // A hint, not a value of the form: without an answer the block stays away.
      if (mine === asking) asked = [];
    }
  }

  // Every stored profile asks again (the first one, a save, a reload after a run).
  $effect(() => {
    if (app.state?.profile !== undefined) untrack(() => void load());
  });
  onMount(() =>
    run.listen((event) => {
      if (event.type === 'finished') void load();
    }),
  );

  /** "Hinzufügen": the term goes into its field of the form; a focused button hands the
   *  focus on. */
  async function add(term: AskedTerm, event: MouseEvent): Promise<void> {
    const button = event.currentTarget;
    const focused = button instanceof HTMLElement && button === document.activeElement;
    const index = shown.indexOf(term);
    putTerm(editor.after, term);
    if (!focused) return;
    await tick();
    // The row now in its place, else the one before, else "Kompetenz hinzufügen".
    const next = shown[Math.min(index, shown.length - 1)];
    const target =
      next === undefined
        ? document.querySelector<HTMLElement>('[data-testid="competence-add"]')
        : list?.querySelector<HTMLElement>(
            `[data-key="${CSS.escape(key(next.term))}"] [data-testid="asked-add"]`,
          );
    target?.focus();
  }
</script>

{#if shown.length > 0}
  <div class="asked" data-testid="asked" transition:unfold={{ on: motion.ready }}>
    <span class="label" id="{id}-label">{t.profile.asked}</span>
    <ul class="terms" aria-labelledby="{id}-label" bind:this={list}>
      {#each shown as term (key(term.term))}
        <li
          class="term"
          data-testid="asked-term"
          data-key={key(term.term)}
          data-field={term.field}
          animate:flip
          out:rowCollapse={{ on: motion.ready }}
        >
          <span class="what">
            <span
              class="words"
              data-copy
              data-testid="asked-words"
              use:tooltip={{ text: term.term, truncated: true }}>{term.term}</span
            >
            <span class="field" data-testid="asked-field">{t.profile.askedField[term.field]}</span>
          </span>
          <span class="count" data-testid="asked-count">{t.profile.askedIn(term.count)}</span>
          <Button
            variant="secondary"
            size="sm"
            icon="add"
            label={t.profile.askedAdd}
            testid="asked-add"
            onclick={(event) => void add(term, event)}
          />
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .asked {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  /* Like every control label of the form (13/500). */
  .label {
    color: var(--text);
    font: var(--type-sm);
    font-weight: var(--weight-medium);
  }

  /* One list between two hairlines, a hairline between its rows (the settings rows). */
  .terms {
    display: flex;
    flex-direction: column;
    border-top: var(--border-width) solid var(--border);
    border-bottom: var(--border-width) solid var(--border);
  }

  .term {
    display: flex;
    align-items: center;
    gap: var(--space-12);
    min-height: calc(var(--control-sm) + 2 * var(--space-8));
    padding-block: var(--space-8);
    border-bottom: var(--border-width) solid var(--border);
    font: var(--type-sm);
  }

  .term:last-child {
    border-bottom: 0;
  }

  /* The term, and quietly its field right after it; the term gives way first. */
  .what {
    display: flex;
    flex: 1;
    align-items: baseline;
    gap: var(--space-8);
    min-width: 0;
  }

  .words {
    min-width: 0;
    overflow: hidden;
    color: var(--text);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .field {
    flex: none;
    color: var(--text-muted);
  }

  .count {
    flex: none;
    color: var(--text-subtle);
  }
</style>
