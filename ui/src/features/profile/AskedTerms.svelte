<!--
  "Häufig verlangt" under the competences: the terms the jobs of the last 30 days ask for most
  that the profile does not name (`asked_terms`), each a quiet tag with its "+", its words
  and its number of jobs. The "+" adds the term as a competence row of the form, an unsaved
  change like any other; a term the form names already (a competence, a synonym, a keyword,
  a tool, a certificate) leaves the tags. The block shows only while it has a term, unfolds
  when it comes and folds away when it goes; it asks again after every save (a new stored
  profile) and every finished run (a fetch, the rescore after a save). A focused "+" that
  goes hands the focus to the next one, else to "Kompetenz hinzufügen".
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import Count from '$components/Count.svelte';
  import { tooltip } from '$lib/actions/tooltip';
  import { t } from '$lib/i18n/t';
  import { invoke } from '$lib/ipc/api';
  import type { AskedTerm, ProfileCompetence } from '$lib/ipc/types';
  import { settled } from '$lib/motion/settled.svelte';
  import { flip, unfold } from '$lib/motion/transitions';
  import { app } from '$lib/state/app.svelte';
  import { editor } from '$lib/state/profile.svelte';
  import { run } from '$lib/state/run.svelte';
  import { onMount, tick, untrack } from 'svelte';

  interface Props {
    /** The competences of the form (a "+" adds one). */
    rows: ProfileCompetence[];
  }

  let { rows = $bindable() }: Props = $props();

  const id = $props.id();
  // The answer that comes while the view is being built is simply there; a block that comes
  // or goes later (a save, a fetch) unfolds or folds.
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

  /** What the form names already. */
  const known = $derived.by((): Set<string> => {
    const form = editor.after;
    return new Set(
      [
        ...rows.flatMap((row) => [row.name, ...row.aliases]),
        ...form.keywords,
        ...form.tools,
        ...form.certificates,
      ].map(key),
    );
  });
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

  /** The "+": the term becomes a competence of the form; a focused "+" hands the focus on. */
  async function add(term: string, event: MouseEvent): Promise<void> {
    const button = event.currentTarget;
    const focused = button instanceof HTMLElement && button === document.activeElement;
    const index = shown.findIndex((each) => each.term === term);
    rows = [...rows, { name: term.trim(), years: null, aliases: [], origin: null }];
    if (!focused) return;
    await tick();
    // The tag now in its place, else the one before, else "Kompetenz hinzufügen".
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
        <li class="term" data-testid="asked-term" data-key={key(term.term)} animate:flip>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon="add"
            label={t.profile.askedAdd}
            testid="asked-add"
            onclick={(event) => void add(term.term, event)}
          />
          <span
            class="words"
            data-copy
            data-testid="asked-words"
            use:tooltip={{ text: term.term, truncated: true }}>{term.term}</span
          >
          <span class="count">
            <Count
              value={term.count}
              tone="plain"
              label={t.profile.askedIn(term.count)}
              testid="asked-count"
            />
          </span>
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

  .terms {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-6);
  }

  /* A quiet tag: the "+" fills its start (its wash has the tag's corners), then the words
     and the number of jobs. */
  .term {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    height: var(--control-sm);
    padding-right: var(--space-8);
    border-radius: var(--radius-control);
    background-color: var(--surface-muted);
    color: var(--text);
    font: var(--type-sm);
  }

  .words {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    display: inline-flex;
    flex: none;
    color: var(--text-subtle);
  }
</style>
