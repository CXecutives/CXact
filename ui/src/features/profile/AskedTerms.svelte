<!--
  "Häufig verlangt" under a field of the profile (user, 2026-09-29): the terms the jobs of the
  last 30 days ask for most that the profile does not name (`asked_terms`: "Anaplan" of
  "Kenntnisse in Anaplan"), each under the field it belongs to (Kompetenzen, Werkzeuge und
  Methoden, Branchen, Sprachen, Zertifikate, Abschlüsse), as a quiet row of small buttons:
  the term and how many jobs ask for it. A click puts the term into this field of the form,
  an unsaved change like any other (the save bar comes); its button goes, and so does a term
  the form names already in any field. The row shows only while it has a term, unfolds when
  it comes and folds away when it goes. The terms are asked once for all the fields, after
  every save (a new stored profile) and every finished run (a fetch, the rescore after a
  save). A focused button that goes hands the focus to the next one, else to its field.
-->
<script lang="ts" module>
  import { invoke } from '$lib/ipc/api';
  import type { AskedTerm } from '$lib/ipc/types';

  /** The answer every field reads. */
  const store = $state<{ asked: AskedTerm[] }>({ asked: [] });

  /** The latest question wins: an older answer that comes late is dropped. */
  let asking = 0;
  async function load(): Promise<void> {
    const mine = ++asking;
    try {
      const answer = await invoke('asked_terms', {});
      if (mine === asking) store.asked = answer;
    } catch {
      // A hint, not a value of the form: without an answer the rows stay away.
      if (mine === asking) store.asked = [];
    }
  }

  /** The fields ask together (one question for all of them in the same moment). */
  let queued = false;
  function ask(): void {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      void load();
    });
  }
</script>

<script lang="ts">
  import Button from '$components/Button.svelte';
  import { t } from '$lib/i18n/t';
  import type { TermField } from '$lib/ipc/types';
  import { settled } from '$lib/motion/settled.svelte';
  import { fade, flip, unfold } from '$lib/motion/transitions';
  import { app } from '$lib/state/app.svelte';
  import { editor } from '$lib/state/profile.svelte';
  import { putTerm, termsOf } from '$lib/state/terms';
  import { run } from '$lib/state/run.svelte';
  import { onMount, tick, untrack } from 'svelte';

  interface Props {
    /** The field of the profile whose terms show here. */
    field: TermField;
    /** The test id of the field's own control, which takes the focus after the last term. */
    home: string;
  }

  let { field, home }: Props = $props();

  const id = $props.id();
  // The answer that comes while the view is being built is simply there; a row or a term
  // that comes or goes later (a save, a fetch, a click) unfolds or folds.
  const motion = settled();
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
  const shown = $derived(
    store.asked.filter((term) => term.field === field && !known.has(key(term.term))),
  );

  // Every stored profile asks again (the first one, a save, a reload after a run).
  $effect(() => {
    if (app.state?.profile !== undefined) untrack(ask);
  });
  onMount(() =>
    run.listen((event) => {
      if (event.type === 'finished') ask();
    }),
  );

  /** The term goes into this field of the form; a focused button hands the focus on. */
  async function add(term: AskedTerm, event: MouseEvent): Promise<void> {
    const button = event.currentTarget;
    const focused = button instanceof HTMLElement && button === document.activeElement;
    const index = shown.indexOf(term);
    putTerm(editor.after, term);
    if (!focused) return;
    await tick();
    // The term now in its place, else the one before, else the field itself.
    const next = shown[Math.min(index, shown.length - 1)];
    if (next !== undefined) {
      list
        ?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key(next.term))}"] button`)
        ?.focus();
      return;
    }
    const own = document.querySelector<HTMLElement>(`[data-testid="${home}"]`);
    (own?.matches('input, button') ? own : own?.querySelector<HTMLElement>('input'))?.focus();
  }
</script>

{#if shown.length > 0}
  <div class="asked" data-testid="asked" data-for={field} transition:unfold={{ on: motion.ready }}>
    <span class="label" id="{id}-label">{t.profile.asked}</span>
    <ul class="terms" aria-labelledby="{id}-label" bind:this={list}>
      {#each shown as term (key(term.term))}
        <li
          data-testid="asked-term"
          data-key={key(term.term)}
          data-term={term.term}
          animate:flip
          out:fade={{ on: motion.ready }}
        >
          <Button
            variant="secondary"
            icon="add"
            label={term.term}
            count={term.count}
            testid="asked-add"
            onclick={(event) => void add(term, event)}
          />
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  /* The quiet word, then the terms, wrapping under each other where the field is narrow. */
  .asked {
    display: flex;
    align-items: flex-start;
    gap: var(--space-8);
  }

  /* Under a field like its hint; under the competences the section's gap spaces it. */
  :global(.field) + .asked {
    padding-top: var(--space-6);
  }

  .label {
    flex: none;
    color: var(--text-subtle);
    font: var(--type-sm);
    line-height: var(--control-sm);
  }

  .terms {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-6);
    min-width: 0;
  }
</style>
