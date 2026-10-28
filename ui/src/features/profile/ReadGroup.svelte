<!--
  A closed group of the Profil as it reads (round 11, "wie Malt"): each row its name (14
  muted) in the label's column and its value as text, a tag field's values as chips (text to
  copy); the day rates in one row ("1.200 € am Tag, mindestens 1.100"); an empty value that
  is not required stays away, a required one that is empty is a red row with the field's
  "… hinzufügen". Kompetenzen and Sprachen read as their entries, name and value. Under the
  pointer a row shows a wash and its pencil; a click on it (not a drag that selected its
  text) or its pencil opens the group at that field (`onopen`). A group with nothing to read
  shows its first field's "… hinzufügen" in navy.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import { t } from '$lib/i18n/t';
  import type { ProfileForm } from '$lib/ipc/types';
  import { editor } from '$lib/state/profile.svelte';
  import { named } from './rows';
  import { LABEL_OF, fieldOf, fieldsOf, type Control, type Section } from './sections';

  interface Props {
    section: Section;
    /** The required fields still empty that are marked. */
    missing: readonly string[];
    /** Opens the group at a field. */
    onopen: (field: string) => void;
  }

  let { section, missing, onopen }: Props = $props();

  const words = $derived(t.profile.field);
  const form = $derived(editor.after);
  const isMissing = (field: string): boolean => missing.includes(field);

  /** What a row says: text, chips, a red row for a required value still empty, or nothing. */
  type Read = { text: string } | { chips: string[] } | { missing: string } | null;

  function readOf(c: Control): Read {
    const amount = (value: number | null, unit: string): Read =>
      value === null ? null : { text: t.profile.read.amount(value, unit) };
    switch (c.kind) {
      case 'number':
        if (!(c.shown?.(form) ?? true)) return null;
        if (c.unit !== 'years') return amount(form[c.key], t.profile.unit[c.unit]);
        return form[c.key] === null ? null : { text: t.profile.read.years(form[c.key] ?? 0) };
      case 'rates':
        return form.dayRateWish === null && form.dayRateMin === null
          ? null
          : { text: t.profile.read.rates(form.dayRateWish, form.dayRateMin) };
      case 'chips': {
        const values = form[c.key].filter((value) => value.trim() !== '');
        if (values.length > 0) return { chips: values };
        return isMissing(c.key) ? { missing: words[c.placeholder] } : null;
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
          return { chips: form.countries.map((code) => t.profile.country[code] ?? code) };
        }
        return isMissing('countries') ? { missing: words.countriesPlaceholder } : null;
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
  function labelOf(c: Control): string {
    if (c.kind === 'rates') return words.dayRate;
    const field = fieldOf(c);
    return String(
      (words as Record<string, unknown>)[LABEL_OF[field as keyof ProfileForm] ?? field],
    );
  }

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

  /** A click on a row opens it there; a drag that selected its text does not. */
  function click(event: PointerEvent, field: string): void {
    if (event.button !== 0) return;
    if ((window.getSelection()?.toString() ?? '') !== '') return;
    onopen(field);
  }
</script>

{#if 'list' in section}
  {#each entries as entry (entry.name)}
    <div class="read item" role="presentation" onpointerup={(event) => click(event, section.list)}>
      <span class="name" data-copy>{entry.name}</span>
      <span class="side" data-copy>{entry.value}</span>
    </div>
  {/each}
  {#if entries.length === 0}
    {@render add(
      section.list,
      section.list === 'competences' ? words.competencePlaceholder : words.languagePlaceholder,
      isMissing(section.list),
    )}
  {/if}
{:else}
  {#each rows as { c, read } (fieldOf(c))}
    {@const field = fieldOf(c)}
    {#if read !== null && 'missing' in read}
      {@render add(field, read.missing, true)}
    {:else if read !== null}
      <div
        class="read"
        data-field={fieldsOf(c).join(' ')}
        role="presentation"
        onpointerup={(event) => click(event, field)}
      >
        <span class="label">{labelOf(c)}</span>
        {#if 'chips' in read}
          <span class="chips">
            {#each read.chips as chip (chip)}<span class="chip" data-copy>{chip}</span>{/each}
          </span>
        {:else}
          <span class="value" data-copy>{read.text}</span>
        {/if}
        <span class="pen">
          <Button
            variant="ghost"
            iconOnly
            icon="edit"
            label={t.profile.editField(labelOf(c))}
            onclick={() => onopen(field)}
          />
        </span>
      </div>
    {/if}
  {/each}
  {#if rows.length === 0 && section.rows[0]}
    {@const first = section.rows[0]}
    {@render add(
      fieldOf(first),
      first.kind === 'chips' ? words[first.placeholder] : labelOf(first),
      false,
    )}
  {/if}
{/if}

<!-- A value still to give: a row that opens the group there, red where it is required. -->
{#snippet add(field: string, text: string, required: boolean)}
  <div class="read add" class:required data-field={field} data-missing={required ? '' : undefined}>
    <Button
      variant="add"
      icon="add"
      label={text}
      testid="add-{field}"
      onclick={() => onopen(field)}
    />
  </div>
{/snippet}

<style>
  /* A row: its name in the label's column, its value as text, its pencil at the end (shown
     under the pointer and with the focus); a hairline between rows. */
  .read {
    display: grid;
    grid-template-columns: var(--profile-label-width) minmax(0, 1fr) var(--control-icon);
    align-items: center;
    gap: var(--space-8) var(--profile-label-gap);
    min-height: var(--profile-read-min);
    padding: var(--profile-read-pad-y) var(--profile-read-pad-end) var(--profile-read-pad-y)
      var(--form-row-pad-x);
    transition: background-color var(--dur-base) var(--ease-standard);
  }

  .read + .read {
    border-top: var(--border-width) solid var(--border);
  }

  .read:not(.add):hover {
    background-color: var(--quiet-hover);
    transition-duration: var(--dur-hover);
  }

  .label {
    color: var(--text-muted);
    font: var(--type-md);
  }

  .value,
  .name {
    min-width: 0;
    font: var(--type-md);
    overflow-wrap: anywhere;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-6);
    min-width: 0;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    min-height: var(--chip-height);
    padding: 0 var(--space-8);
    border-radius: var(--radius-inner);
    background-color: var(--chip-surface);
    color: var(--chip-text);
    font: var(--type-chip);
  }

  .pen {
    display: inline-flex;
    opacity: 0;
    transition: opacity var(--dur-base) var(--ease-standard);
  }

  .read:hover .pen,
  .pen:focus-within {
    opacity: 1;
    transition-duration: var(--dur-hover);
  }

  /* A list's entry: its name, its value at the right. */
  .item {
    grid-template-columns: minmax(0, 1fr) auto;
    padding-right: var(--form-row-pad-x);
  }

  .side {
    color: var(--text-muted);
    font: var(--type-md);
    font-variant-numeric: tabular-nums;
  }

  /* A value still to give: the navy add, red where it is required. */
  .add {
    grid-template-columns: minmax(0, 1fr);
  }

  .required {
    --link: var(--field-label-missing);
    --link-hover: var(--field-label-missing);
  }
</style>
