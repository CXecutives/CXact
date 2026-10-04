<!--
  The languages (user 2026-10-04), no dropdowns: one row each with the language's name, its
  level as a segmented control of four plain levels (Grundkenntnisse, Gut, Fließend,
  Muttersprache, stored as A2, B2, C1 and native; a stored A1 or B1 shows as Grundkenntnisse,
  a C2 as Fließend, and stays until another level is chosen) and its x. "+ Sprache" opens an
  inline field under the rows: the common languages not chosen yet as quick picks
  (QuickPicks), and typing finds any other language the app knows; a new language starts at
  Gut, the level the engine assumes. Without a language the field stands open (with the amber
  edge while it is marked as missing). The x needs no tooltip; removing a row puts no caret
  anywhere (input.ts removeBy). A value the backend refused is said under the rows.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import ChipInput from '$components/ChipInput.svelte';
  import Segmented from '$components/Segmented.svelte';
  import { de } from '$lib/i18n/de';
  import { t } from '$lib/i18n/t';
  import { removeBy } from '$lib/input/input';
  import type { Language, LanguageLevel } from '$lib/state/profile.svelte';
  import { tick } from 'svelte';
  import QuickPicks from './QuickPicks.svelte';

  interface Props {
    rows: Language[];
    /** Marked as missing: the open field shows the amber edge. */
    missing?: boolean;
    /** A value the backend refused and why. */
    error?: { row: number | null; text: string } | null;
  }

  let { rows = $bindable(), missing = false, error = null }: Props = $props();

  const words = $derived(t.profile.field);
  const id = $props.id();
  type Shown = keyof typeof de.profile.level;
  /** The level a new language starts at (the one the engine assumes without one). */
  const ASSUMED: Shown = 'B2';
  /** The plain level a stored level shows as. */
  const SHOWN: Record<LanguageLevel, Shown> = {
    A1: 'A2',
    A2: 'A2',
    B1: 'A2',
    B2: 'B2',
    C1: 'C1',
    C2: 'C1',
    native: 'native',
  };
  const LEVELS = $derived(
    (Object.keys(t.profile.level) as Shown[]).map((level) => ({
      id: level,
      label: t.profile.level[level],
    })),
  );
  /** Every language the app knows by its German name, and the common ones as quick picks. */
  const ALL: readonly string[] = Object.values(de.profile.languageName).sort((a, b) =>
    a.localeCompare(b),
  );
  const OPTIONS = ALL.map((name) => ({ id: name, label: name, terms: [name] }));
  const COMMON = ['de', 'en', 'fr', 'es', 'it', 'nl', 'pl'].map(
    (code) => de.profile.languageName[code as keyof typeof de.profile.languageName],
  );

  const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
  const chosen = (name: string): boolean => rows.some((row) => same(row.language, name));

  let adding = $state(false);
  const open = $derived(adding || rows.length === 0);

  function add(name: string): void {
    if (!chosen(name)) rows = [...rows, { language: name, level: ASSUMED }];
    adding = false;
  }

  async function startAdding(): Promise<void> {
    adding = !adding;
    await tick();
    document.querySelector<HTMLInputElement>(`#${CSS.escape(id)}-add`)?.focus();
  }

  const remove = (row: Language): void => {
    rows = rows.filter((other) => other !== row);
  };
</script>

<div class="languages" data-testid="languages" data-removes>
  {#if rows.length > 0}
    <div class="list">
      {#each rows as row (row)}
        <div class="row" data-row data-testid="language-row">
          <span class="name" data-copy data-testid="language-name">{row.language}</span>
          <Segmented
            options={LEVELS}
            value={SHOWN[row.level]}
            label={words.level}
            testid="language-level"
            onchange={(next) => (row.level = next)}
          />
          <span class="remove" data-remove>
            <Button
              variant="ghost"
              iconOnly
              icon="close"
              plain
              label={words.removeLanguage(row.language)}
              testid="language-remove"
              onclick={(event) => removeBy(event.currentTarget, () => remove(row))}
            />
          </span>
        </div>
      {/each}
    </div>
  {/if}
  {#if error}
    <p class="error" id="{id}-error" role="alert" data-testid="language-error">{error.text}</p>
  {/if}
  {#if open}
    <div class="adder" data-testid="language-adder">
      <ChipInput
        id="{id}-add"
        values={[]}
        options={OPTIONS.filter((option) => !chosen(option.id))}
        noMatch={words.languageNone}
        placeholder={words.languagePlaceholder}
        {missing}
        testid="language-input"
        onchange={(names) => {
          const name = names[0];
          if (name !== undefined) add(name);
        }}
      />
      <QuickPicks
        picks={COMMON.filter((name) => !chosen(name)).map((name) => ({ id: name, label: name }))}
        testid="language-pick"
        onpick={add}
      />
    </div>
  {/if}
  {#if rows.length > 0}
    <span class="add" data-remove-fallback>
      <Button
        variant="ghost"
        icon="add"
        label={words.addLanguage}
        testid="language-add"
        onclick={() => void startAdding()}
      />
    </span>
  {/if}
</div>

<style>
  .languages {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    min-width: 0;
  }

  /* name | level | remove in one grid for every row, the levels lined up. */
  .list {
    display: grid;
    grid-template-columns: minmax(0, 1fr) max-content var(--control-field);
    align-items: center;
    gap: var(--space-6) var(--space-12);
  }

  .row {
    display: contents;
  }

  .name {
    overflow: hidden;
    color: var(--text);
    font: var(--type-md);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .remove {
    display: flex;
    align-items: center;
    height: var(--control-field);
  }

  .adder {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  /* The quiet add button: its glyph on the rows' text. */
  .add {
    display: flex;
    margin-left: calc(-1 * var(--ghost-inset));
  }

  .error {
    color: var(--danger-strong);
    font: var(--type-sm);
  }
</style>
