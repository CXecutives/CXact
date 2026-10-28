<!--
  The profile as groups of rows (round 11, the owner's choice "wie Malt"): the groups of
  `sections.ts` in their order (Wunschjob, Einsatz, Erfahrung, Kompetenzen, Sprachen,
  Ausschlüsse), each a Section with one white box of rows (Group `rows`), like the rows of
  Einstellungen.
  On the Profil a group reads like a profile while it is closed (ReadGroup); only
  "Bearbeiten" at its title opens it (one way to edit, owner 2026-10-28), the caret in its
  first field. One
  group is open at a time: its box has the navy edge, its rows are the fields
  (ProfileControl; a hairline between rows), and its foot holds Fertig and Abbrechen in the
  order of the OS, one width. Fertig (and Enter in a field) saves at once (`onsave`) and
  closes the group; Abbrechen (and Esc) puts the stored values back; opening another group
  saves the open one first. A new form and the setup show every group open, without a foot
  (the view's bar or the setup's Weiter save). Mindestgehalt unfolds while Festanstellung or
  Zeitarbeit is chosen.
  A required field that is still empty carries `data-missing` on its row, a required list
  on its group (`missing`, from ProfileView: on the Profil always, in the setup once Weiter
  asked): the field's edge and label turn red, a list's group title (tokens.css); a closed
  group shows it as a red row. A value that is too large, a 0 where at least 1 counts, a day
  that does not read and a value the backend refused are said at their field in their own
  sentence, stay with their error until they change, and only they hold the save (the first
  of them is revealed, its group opened, when a save is tried; `wrongField` names it).
  Enter in a tag field or a list's add field takes what was typed; an untouched new form
  goes back to the ways in with Esc (not in the setup).
-->
<script lang="ts" module>
  /** A value the backend refused on the last save: the field (and row) it names, its words. */
  export interface FieldError {
    field: string;
    row: number | null;
    text: () => string;
  }
</script>

<script lang="ts">
  import Button from '$components/Button.svelte';
  import Group from '$components/Group.svelte';
  import Section from '$components/Section.svelte';
  import { t } from '$lib/i18n/t';
  import { formKeys } from '$lib/input/input';
  import type { ProfileForm } from '$lib/ipc/types';
  import { MAX_YEARS, NUMBER_LIMITS } from '$lib/ipc/types/profile';
  import { unfold } from '$lib/motion/transitions';
  import { primaryFirst } from '$lib/platform';
  import { dayShaped, editor } from '$lib/state/profile.svelte';
  import { tick } from 'svelte';
  import CompetenceList from './CompetenceList.svelte';
  import LanguageList from './LanguageList.svelte';
  import ProfileControl from './ProfileControl.svelte';
  import ReadGroup from './ReadGroup.svelte';
  import {
    LABEL_OF,
    SECTIONS,
    fieldOf,
    fieldsOf,
    sectionOf,
    type Control,
    type NumberKey,
    type SectionId,
  } from './sections';
  import { vocabulary } from './vocabulary.svelte';

  interface Props {
    /** A value the backend refused on the last save. */
    fieldError: FieldError | null;
    /** The required fields still empty that are marked. */
    missing: readonly string[];
    /** The setup's page: every group open, Esc does nothing. */
    setup?: boolean;
    /** A save is under way (Fertig waits). */
    busy?: boolean;
    /** Saves the form; `true` once it is saved (or there was nothing to save). */
    onsave: () => Promise<boolean> | void;
    ondiscard: () => void;
  }

  let { fieldError, missing, setup = false, busy = false, onsave, ondiscard }: Props = $props();

  // Text typed into a tag field of the form counts as a change.
  editor.typed.share();

  const words = $derived(t.profile.field);
  const id = $props.id();
  const form = $derived(editor.after);
  vocabulary.load();

  // ------------------------------------------------------------ open and closed groups

  /** Every group open: the setup and a form that was never stored. */
  const allOpen = $derived(setup || editor.origin === 'new');
  /** The one group open on the Profil (null: every group reads). */
  let open = $state<SectionId | null>(null);
  const isOpen = (section: SectionId): boolean => allOpen || open === section;
  const actionFirst = primaryFirst();

  /** Opens a group at one of its fields (or its first), saving the group open before. */
  async function openGroup(section: SectionId, field: string | null): Promise<void> {
    if (!allOpen && open !== section) {
      if (open !== null && editor.dirty && !(await onsave())) return;
      open = section;
    }
    await tick();
    if (field !== null) await focusField(field);
    else firstControl(root?.querySelector<HTMLElement>(`[data-group="${section}"]`))?.focus();
  }

  /** Fertig: saves the open group and closes it once it is saved. */
  async function done(): Promise<void> {
    if (editor.dirty && !(await onsave())) return;
    open = null;
  }

  function cancel(): void {
    ondiscard();
    open = null;
  }

  // ------------------------------------------------------------ values that hold the save

  /** Day rates where 0 is nothing a job could meet: a typed 0 is said and holds the save. */
  const AT_LEAST_ONE: readonly NumberKey[] = ['dayRateWish', 'dayRateMin'];

  /** Values the form knows are wrong before anything is sent: too large, or a 0 where at
   *  least 1 counts. Each is said at its field and holds the save. */
  const invalid = $derived.by((): { field: string; row: number | null; text: string }[] => {
    const found: { field: string; row: number | null; text: string }[] = [];
    for (const [key, max] of Object.entries(NUMBER_LIMITS) as [NumberKey, number][]) {
      const value = form[key];
      if (value !== null && value > max) {
        found.push({ field: key, row: null, text: words.atMost(max) });
      } else if (value === 0 && AT_LEAST_ONE.includes(key)) {
        found.push({ field: key, row: null, text: words.atLeast(1) });
      }
    }
    // A competence's years, counted among the rows with a name (as the backend does).
    const rows = form.competences.filter((row) => row.name.trim() !== '');
    const row = rows.findIndex((each) => each.years !== null && each.years > MAX_YEARS);
    if (row >= 0) found.push({ field: 'competences', row, text: words.atMost(MAX_YEARS) });
    return found;
  });

  /** "Ab Datum" with a day that does not read, once it is judged. */
  const dateWrong = $derived(
    editor.judged && editor.dateInvalid
      ? dayShaped(editor.dateText)
        ? words.dateImpossible
        : words.dateInvalid
      : null,
  );

  /** A field's label as the page shows it. */
  const labelOf = (field: string): string =>
    String((words as Record<string, unknown>)[LABEL_OF[field as keyof ProfileForm] ?? field]);

  /** The label of the first value that holds the save (null: none does). */
  export function wrongField(): string | null {
    const field =
      fieldError?.field ??
      (editor.judged && editor.dateInvalid ? 'available' : (invalid[0]?.field ?? null));
    return field === null ? null : labelOf(field);
  }

  /** The error of a field: a value the backend refused, else one that is wrong as it is. */
  function errorOf(field: string): string | null {
    if (fieldError?.field === field) return fieldError.text();
    if (field === 'available' && dateWrong !== null) return dateWrong;
    return invalid.find((each) => each.field === field)?.text ?? null;
  }

  /** The row of a list that is marked (a refusal first, then a value that is wrong). */
  function listError(field: string): { row: number | null; text: string } | null {
    if (fieldError?.field === field) return { row: fieldError.row, text: fieldError.text() };
    const wrong = invalid.find((each) => each.field === field);
    return wrong ? { row: wrong.row, text: wrong.text } : null;
  }

  const isMissing = (field: string): boolean => missing.includes(field);
  /** A row shows while its field has something to do (Mindestgehalt). */
  const shown = (control: Control): boolean =>
    control.kind !== 'number' || (control.shown?.(form) ?? true);

  // ------------------------------------------------------------ saving

  let root = $state<HTMLElement | null>(null);

  /** The control of a field (or a group) that takes the caret: its text input before any
   *  button, so the focus never lands on a chip's ×. */
  function firstControl(scope: HTMLElement | null | undefined): HTMLElement | null {
    return (
      scope?.querySelector<HTMLElement>('input, textarea') ??
      scope?.querySelector<HTMLElement>('button:not([data-testid="info-tip"])') ??
      null
    );
  }

  /** Ready to save: a value that holds the save is said at its field, which comes into view
   *  (a day that does not read gets the caret). */
  export function ready(): boolean {
    editor.judged = true;
    if (editor.dateInvalid) {
      void focusField('available');
      return false;
    }
    const wrong = invalid[0] ?? null;
    if (wrong !== null) void revealField(wrong.field);
    return wrong === null && fieldError === null;
  }

  /** The caret into a field of the form (its marked control first), in the middle of the
   *  view, its group opened first; `false` when the field is not on the page. */
  export async function focusField(field: string): Promise<boolean> {
    const section = sectionOf(field);
    if (section !== null && !isOpen(section)) await openGroup(section, null);
    await tick();
    const scope = root?.querySelector<HTMLElement>(`[data-edit~="${field}"]`);
    const target =
      scope?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? firstControl(scope);
    target?.focus({ preventScroll: true });
    (target ?? scope)?.scrollIntoView({ block: 'center' });
    return target !== null && target !== undefined;
  }

  /** A field of the form in the middle of the view, without the caret (Speichern and Weiter
   *  only show what is missing or wrong). A wrong value opens its group; a missing one shows
   *  as its red row in a closed group. */
  export async function revealField(field: string): Promise<boolean> {
    const section = sectionOf(field);
    const wrong = invalid.some((each) => each.field === field) || fieldError?.field === field;
    if (section !== null && wrong && !isOpen(section)) open = section;
    await tick();
    const scope = root?.querySelector<HTMLElement>(`[data-field~="${field}"]`);
    scope?.scrollIntoView({ block: 'center' });
    return scope !== null && scope !== undefined;
  }

  /** A new form nothing was typed into: Esc goes back to the ways in. */
  const untouched = $derived(editor.origin === 'new' && !editor.dirty);
  const save = (): void => void onsave();
  const rootKeys = $derived(untouched && !setup ? { save, cancel: ondiscard } : { save });
</script>

<div
  class="editor"
  bind:this={root}
  use:formKeys={allOpen ? rootKeys : {}}
  data-testid="profile-form"
>
  {#each SECTIONS as section (section.id)}
    {@const list = 'list' in section ? section.list : null}
    {@const editing = isOpen(section.id)}
    {#snippet edit()}
      <Button
        variant="ghost"
        icon="edit"
        label={t.profile.edit}
        testid="edit-{section.id}"
        onclick={() => void openGroup(section.id, null)}
      />
    {/snippet}
    <div
      class="group"
      data-group={section.id}
      data-field={list ?? undefined}
      data-missing={list !== null && isMissing(list) ? '' : undefined}
    >
      <Section
        id="profile-section-{section.id}"
        name={section.id}
        heading={t.profile.section[section.id]}
        actions={editing ? null : edit}
        testid="section-{section.id}"
      >
        <Group rows active={editing && !allOpen}>
          {#if !editing}
            <ReadGroup {section} {missing} />
          {:else}
            <div
              data-edit={list ?? undefined}
              use:formKeys={allOpen ? {} : { save: () => void done(), cancel }}
            >
              {#if list === 'competences'}
                <CompetenceList bind:rows={form.competences} error={listError('competences')} />
              {:else if list === 'languages'}
                <LanguageList bind:rows={form.languages} error={listError('languages')} />
              {:else if 'rows' in section}
                {#each section.rows as c (fieldOf(c))}
                  {#if shown(c)}
                    <div
                      class="cell"
                      data-field={fieldsOf(c).join(' ')}
                      data-edit={fieldsOf(c).join(' ')}
                      data-missing={isMissing(fieldOf(c)) ? '' : undefined}
                      transition:unfold
                    >
                      <div class="row"><ProfileControl {c} {id} {errorOf} /></div>
                    </div>
                  {/if}
                {/each}
              {/if}
            </div>
            {#if !allOpen}
              <div class="foot">
                <div class="pair" class:first={actionFirst}>
                  <Button
                    variant="primary"
                    label={t.profile.done}
                    loading={busy}
                    testid="done-{section.id}"
                    onclick={() => void done()}
                  />
                  <Button
                    variant="secondary"
                    label={t.common.cancel}
                    disabled={busy}
                    testid="cancel-{section.id}"
                    onclick={cancel}
                  />
                </div>
              </div>
            {/if}
          {/if}
        </Group>
      </Section>
    </div>
  {/each}
</div>

<style>
  /* The groups, 30 apart (Section). */
  .editor {
    display: flex;
    flex-direction: column;
    gap: var(--group-section-gap);
  }

  .group {
    min-width: 0;
  }

  /* The rows of a box, a hairline between them; a row that unfolds (Mindestgehalt) brings
     its line along. */
  .cell + .cell {
    border-top: var(--border-width) solid var(--border);
  }

  .row {
    display: grid;
    align-content: center;
    min-height: var(--form-row-min);
    padding: var(--form-row-pad-y) var(--form-row-pad-x);
  }

  /* The open group's foot: Fertig and Abbrechen, one width, in the order of the OS. */
  .foot {
    display: flex;
    justify-content: flex-end;
    padding: var(--form-row-pad-y) var(--form-row-pad-x);
    border-top: var(--border-width) solid var(--border);
  }

  .pair {
    display: grid;
    grid-auto-columns: 1fr;
    grid-auto-flow: column;
    gap: var(--space-8);
  }

  .pair:not(.first) > :global(:first-child) {
    order: 2;
  }

  /* Tab and focus scrolling keep a field clear of the top bar's fade and of the bar at the
     foot. */
  .editor :global(:is(input, textarea, button, [role='switch'])) {
    scroll-margin-top: calc(var(--fade-height) + var(--space-8));
    scroll-margin-bottom: calc(var(--bar-min) + var(--space-16));
  }
</style>
