<!--
  A closed group of the Profil as it reads (round 11, "wie Malt"), in the rows of Einstellungen
  (one measure: at least 62 high, 12 20 inside, a hairline between rows): each row its name
  (14/540 ink, like a setting's name) in the label's column and its value as text (14), a tag
  field's values joined by commas (text to copy; chips only while editing, owner 2026-10-30). An empty value that is not required stays away; a
  required one that is empty says "Noch keine Angabe", calm grey (the card under the head says
  what is missing, owner 2026-10-29); a group with nothing to read says it once. Kompetenzen
  and Sprachen read as rows too: the entry's name as the label, its value beside it. Nothing here reacts: only the group's "Bearbeiten" opens it (owner,
  2026-10-28: one way to edit).
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';
  import type { ProfileForm } from '$lib/ipc/types';
  import { editor } from '$lib/state/profile.svelte';
  import { named } from './rows';
  import { LABEL_OF, fieldOf, fieldsOf, type Control, type Section } from './sections';

  interface Props {
    section: Section;
    /** The required fields still empty that are marked. */
    missing: readonly string[];
  }

  let { section, missing }: Props = $props();

  const words = $derived(t.profile.field);
  const form = $derived(editor.after);
  const isMissing = (field: string): boolean => missing.includes(field);

  /** What a row says: text, a required value still empty, or nothing. */
  type Read = { text: string } | { missing: true } | null;

  function readOf(c: Control): Read {
    switch (c.kind) {
      case 'number': {
        if (!(c.shown?.(form) ?? true)) return null;
        const value = form[c.key];
        if (value === null) return null;
        return {
          text:
            c.unit === 'years'
              ? t.profile.read.years(value)
              : t.profile.read.amount(value, t.profile.unit[c.unit]),
        };
      }
      case 'chips': {
        const values = form[c.key].filter((value) => value.trim() !== '');
        if (values.length > 0) return { text: values.join(', ') };
        return isMissing(c.key) ? { missing: true } : null;
      }
      case 'contracts':
        return {
          text: (['project', 'permanent', 'temporary'] as const)
            .filter((key) => form[key])
            .map((key) => t.profile.contract[key])
            .join(', '),
        };
      case 'choice':
        return {
          text:
            c.key === 'workMode'
              ? t.profile.workMode[form.workMode]
              : t.profile.workload[form.workload],
        };
      case 'months':
        return { text: t.profile.minMonths[form.minMonths] };
      case 'countries':
        if (form.countries.length > 0) {
          return {
            text: form.countries.map((code) => t.profile.country[code] ?? code).join(', '),
          };
        }
        return isMissing('countries') ? { missing: true } : null;
      case 'available':
        return {
          text:
            form.available.kind === 'from'
              ? t.profile.read.from(form.available.date)
              : t.profile.availability.now,
        };
    }
  }

  /** The label a row reads under. */
  const labelOf = (c: Control): string => {
    const field = fieldOf(c);
    return String(
      (words as Record<string, unknown>)[LABEL_OF[field as keyof ProfileForm] ?? field],
    );
  };

  /** The entries of a list as they read: name and value. */
  const entries = $derived.by((): { name: string; value: string }[] => {
    if (!('list' in section)) return [];
    return section.list === 'competences'
      ? named(form.competences, (row) => row.name).map((row) => ({
          name: row.name,
          value: row.years === null ? '' : t.profile.read.years(row.years),
        }))
      : named(form.languages, (row) => row.language).map((row) => ({
          name: row.language,
          value: t.profile.level[row.level],
        }));
  });

  const rows = $derived(
    'rows' in section
      ? section.rows.map((c) => ({ c, read: readOf(c) })).filter((each) => each.read !== null)
      : [],
  );
</script>

{#if 'list' in section}
  {#each entries as entry (entry.name)}
    <div class="read">
      <span class="label" data-copy>{entry.name}</span>
      <span class="value" data-copy>{entry.value}</span>
    </div>
  {/each}
  {#if entries.length === 0}
    <div class="read item" data-missing={isMissing(section.list) ? '' : undefined}>
      <span class="none">{t.profile.read.none}</span>
    </div>
  {/if}
{:else}
  {#each rows as { c, read } (fieldOf(c))}
    <div
      class="read"
      data-field={fieldsOf(c).join(' ')}
      data-missing={read !== null && 'missing' in read ? '' : undefined}
    >
      <span class="label">{labelOf(c)}</span>
      {#if read !== null && 'missing' in read}
        <span class="none">{t.profile.read.none}</span>
      {:else if read !== null}
        <span class="value" data-copy>{read.text}</span>
      {/if}
    </div>
  {/each}
  {#if rows.length === 0}
    <div class="read item"><span class="none">{t.profile.read.none}</span></div>
  {/if}
{/if}

<style>
  /* A row of Einstellungen: its name in the label's column, its value beside it. */
  .read {
    display: grid;
    grid-template-columns: var(--profile-label-width) minmax(0, 1fr);
    align-items: center;
    gap: var(--space-8) var(--profile-label-gap);
    min-height: var(--form-row-min);
    padding: var(--form-row-pad-y) var(--form-row-pad-x);
  }

  .read + .read {
    border-top: var(--border-width) solid var(--border);
  }

  .label {
    font: var(--type-label);
  }

  .value {
    min-width: 0;
    font: var(--type-md);
    overflow-wrap: anywhere;
  }

  /* A list's entry: its name, its value at the right. */
  .item {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .none {
    color: var(--text-muted);
    font: var(--type-md);
  }
</style>
