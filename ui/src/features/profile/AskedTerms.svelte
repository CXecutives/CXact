<!--
  "Häufig verlangt" under a field of the profile (user, 2026-09-29; decision 13 of round 10):
  the terms the jobs of the last 30 days ask for most that the profile does not name
  (`asked_terms`: "Anaplan" of "Kenntnisse in Anaplan"), each under the field it belongs to
  (Kompetenzen, Tools und Methoden, Branchen, Sprachen, Zertifikate, Abschlüsse; under an
  item list's add row), as a suggestion row (SuggestRow), without counts. A click puts the
  term into this field of the form, an unsaved change like any other (Speichern comes); its
  chip goes, and so does a term the form names already in any field. The terms are asked
  once for all the fields, after every save (a new stored profile) and every finished run (a
  fetch, the rescore after a save).
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
  import { t } from '$lib/i18n/t';
  import type { TermField } from '$lib/ipc/types';
  import { app } from '$lib/state/app.svelte';
  import { editor } from '$lib/state/profile.svelte';
  import { putTerm, termsOf } from '$lib/state/terms';
  import { run } from '$lib/state/run.svelte';
  import { onMount, untrack } from 'svelte';
  import SuggestRow from './SuggestRow.svelte';

  interface Props {
    /** The field of the profile whose terms show here. */
    field: TermField;
    /** The test id of the field's own control, which takes the focus after the last term. */
    home: string;
    /** The last line of a box of entries (Kompetenzen, Sprachen). */
    line?: boolean;
  }

  let { field, home, line = false }: Props = $props();

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

  function add(id: string): void {
    const term = shown.find((each) => key(each.term) === id);
    if (term !== undefined) putTerm(editor.after, term);
  }
</script>

<div class="asked" data-for={field}>
  <SuggestRow
    label={t.profile.asked}
    picks={shown.map((term) => ({ id: key(term.term), label: term.term }))}
    {home}
    {line}
    testid="asked"
    onpick={add}
  />
</div>

<style>
  .asked {
    display: contents;
  }
</style>
