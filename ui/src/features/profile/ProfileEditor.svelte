<!--
  The profile as groups of rows (the owner's choice of 2026-10-30): the groups of `sections.ts`
  in their order (Wunschjob, Einsatz, Erfahrung, Kompetenzen, Sprachen, Ausschlüsse), each a
  Section with one white box of rows (Group `rows`), and like the rows of Einstellungen every
  value changes where it stands: its control in one column (ProfileControl; a hairline between
  rows). Nothing opens and nothing is confirmed: ProfileView saves a change by itself (`onleft`
  says focus left a field, Enter in a field is `onsave`), the setup with its Weiter, which its
  Enter is too (FirstRunView, around the form). No field takes the caret by itself (owner,
  2026-10-30). Mindestgehalt unfolds while Festanstellung or Zeitarbeit is chosen, the day rates
  while Projekt und Interim is; a value out of sight holds no save (ProfileControl: what is
  wrong stays behind with its row, a right day rate stays stored).
  A required field that is still empty carries `data-missing` on its row, a required list
  on its group (`missing`, from ProfileView: only in the setup, once Weiter asked): the field's
  edge and label turn red, a list's group title (tokens.css). A value that
  is too large, a 0 where at least 1 counts, a day that does not read and a value the backend
  refused are said at their field in their own sentence, stay with their error until they
  change, and only they hold the save (`wrongField` names the first).
  Enter in a tag field or a list's name field takes what was typed; an untouched new form goes
  back to the ways in with Esc (not in the setup).
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
  import Group from '$components/Group.svelte';
  import Section from '$components/Section.svelte';
  import { t } from '$lib/i18n/t';
  import { afterPress, byKeyboard, formKeys } from '$lib/input/input';
  import type { ProfileForm } from '$lib/ipc/types';
  import { MAX_YEARS, NUMBER_LIMITS } from '$lib/ipc/types/profile';
  import { glideIntoView, glideTo, scrollerOf } from '$lib/motion/scroll';
  import { unfold } from '$lib/motion/transitions';
  import { dayShaped, editor } from '$lib/state/profile.svelte';
  import { onMount, tick } from 'svelte';
  import CompetenceList from './CompetenceList.svelte';
  import LanguageList from './LanguageList.svelte';
  import ProfileControl from './ProfileControl.svelte';
  import { keyOf } from './rows';
  import { LABEL_OF, SECTIONS, fieldOf, fieldsOf, type Control, type NumberKey } from './sections';
  import { vocabulary } from './vocabulary.svelte';

  interface Props {
    /** A value the backend refused on the last save. */
    fieldError: FieldError | null;
    /** The required fields still empty that are marked. */
    missing: readonly string[];
    /** Enter in a field: saves the form (not in the setup, where it goes on to its step). */
    onsave?: () => Promise<boolean>;
    /** Esc on a new form nothing was typed into (not in the setup). */
    ondiscard?: () => void;
    /** Focus left a field of the form. */
    onleft?: () => void;
  }

  let { fieldError, missing, onsave, ondiscard, onleft }: Props = $props();

  // Text typed into a tag field of the form counts as a change.
  editor.typed.share();

  const words = $derived(t.profile.field);
  const id = $props.id();
  const form = $derived(editor.after);
  vocabulary.load();

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

  /** What holds the save goes back to what was handed out, and only that ("Verwerfen": the
   *  question names one value, and the other changes stay): a day that does not read, a number
   *  that is wrong, a competence's years by its name, and a value the backend refused. */
  export function dropWrong(): void {
    if (editor.dateInvalid) editor.storedDay();
    for (const key of Object.keys(NUMBER_LIMITS) as NumberKey[]) {
      if (invalid.some((each) => each.field === key)) form[key] = editor.before[key];
    }
    for (const row of form.competences) {
      if (row.years !== null && row.years > MAX_YEARS) {
        const was = editor.before.competences.find((each) => keyOf(each.name) === keyOf(row.name));
        row.years = was?.years ?? null;
      }
    }
    if (fieldError !== null) editor.restore(fieldError.field, fieldError.row);
  }

  /** A field's label as the page shows it. */
  const labelOf = (field: string): string =>
    String((words as Record<string, unknown>)[LABEL_OF[field as keyof ProfileForm] ?? field]);

  /** The first value that holds the save (null: none does). */
  const heldField = (): string | null =>
    fieldError?.field ?? (editor.dateInvalid ? 'available' : (invalid[0]?.field ?? null));

  /** The label of the first value that holds the save (null: none does). */
  export function wrongField(): string | null {
    const field = heldField();
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

  // ------------------------------------------------------------ the rates against each other

  /** A day rate holds the caret. */
  let rating = $state(false);
  const isRate = (node: EventTarget | null): boolean =>
    node instanceof HTMLInputElement &&
    node.closest('[data-field="dayRateWish"], [data-field="dayRateMin"]') !== null;
  /** The wished rate is under the minimum, as last judged: once neither rate holds the caret,
   *  so what is on its way to a value says nothing and moves no row. */
  let below = $state(false);
  $effect(() => {
    const { dayRateWish: wish, dayRateMin: least } = form;
    if (!rating) below = wish !== null && least !== null && wish < least;
  });

  const isMissing = (field: string): boolean => missing.includes(field);
  /** A row shows while its field has something to do (Mindestgehalt). */
  const shown = (control: Control): boolean =>
    control.kind !== 'number' || (control.shown?.(form) ?? true);

  // ------------------------------------------------------------ saving

  let root = $state<HTMLElement | null>(null);

  /** The field typed in since the caret came to it. */
  let typedIn: EventTarget | null = null;

  /** The caret stands in a field typed in: its value is not done yet, and what the form sends
   *  would hold half of it. A field the caret only came to holds what it held. */
  export function typing(): boolean {
    return typedIn !== null && document.activeElement === typedIn;
  }

  /** The focus left a control of the form, for good once the press that left it has landed. */
  function focusLeft(event: FocusEvent): void {
    const toRate = isRate(event.relatedTarget);
    afterPress(event.target, () => {
      if (!toRate) rating = false;
      typedIn = null;
      onleft?.();
    });
  }

  /** Nothing holds the save; a day that does not read says so now. */
  export function valid(): boolean {
    if (editor.dateInvalid) editor.judged = true;
    return heldField() === null;
  }

  /** Asked to go on (the setup's Weiter): what holds the save is said at its field, which
   *  comes into view; `true` when nothing does. */
  export function ready(): boolean {
    editor.judged = true;
    const field = heldField();
    if (field !== null) void revealField(field);
    return field === null;
  }

  /** A field of the form glides up under the top bar, so the press always moves it, without
   *  the caret; from the keyboard its row holds the focus (no caret, no ring), so that Tab goes
   *  on from there. With `move` off the page stays; `false` when the field is not on the page. */
  export async function revealField(field: string, move = true): Promise<boolean> {
    await tick();
    const scope = root?.querySelector<HTMLElement>(`[data-field~="${field}"]`);
    if (scope === null || scope === undefined) return false;
    if (!move) return true;
    glideIntoView(scope, 'start');
    if (byKeyboard()) {
      scope.tabIndex = -1;
      scope.focus({ preventScroll: true });
    }
    return true;
  }

  /** The page glides up to its head and the state boxes under it: what the user's own action
   *  caused comes into view. */
  export async function showHead(): Promise<void> {
    await tick();
    const pane = root === null ? null : scrollerOf(root);
    if (pane !== null) glideTo(pane, 0);
  }

  // The way in that opened the form is gone: Esc and Enter reach the form (no caret).
  onMount(() => {
    if (document.activeElement === document.body) root?.focus({ preventScroll: true });
  });

  /** A new form nothing was typed into: Esc goes back to the ways in. */
  const untouched = $derived(editor.origin === 'new' && !editor.dirty);
  const rootKeys = $derived({
    ...(onsave ? { save: () => void onsave() } : {}),
    ...(ondiscard && untouched ? { cancel: ondiscard } : {}),
  });
</script>

<div
  class="editor"
  tabindex="-1"
  role="group"
  bind:this={root}
  use:formKeys={rootKeys}
  onfocusin={(event) => (rating = isRate(event.target))}
  onfocusout={focusLeft}
  oninput={(event) => (typedIn = event.target)}
  data-testid="profile-form"
>
  {#each SECTIONS as section (section.id)}
    {@const list = 'list' in section ? section.list : null}
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
        testid="section-{section.id}"
      >
        <Group rows>
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
                  data-missing={isMissing(fieldOf(c)) ? '' : undefined}
                  transition:unfold
                >
                  <div class="row"><ProfileControl {c} {id} {errorOf} {below} /></div>
                </div>
              {/if}
            {/each}
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

  /* The rows of a box, a hairline from the text between them like the rows of Einstellungen;
     a row that unfolds (Mindestgehalt) brings its line along. */
  .cell {
    position: relative;
  }

  .cell + .cell::before {
    position: absolute;
    top: 0;
    right: 0;
    left: var(--setting-rule-start);
    height: var(--border-width);
    background-color: var(--border);
    content: '';
  }

  /* The control 16 under the line: a message under it only grows the row downward. */
  .row {
    display: grid;
    min-height: var(--form-row-min);
    padding: var(--form-row-control-y) var(--form-row-pad-x);
  }

  /* A row brought into view (Ergänzen, Weiter) stands clear of the top bar's fade. */
  .editor :global([data-field]) {
    scroll-margin-top: calc(var(--fade-height) + var(--space-8));
  }

  /* Tab and focus scrolling keep a field clear of the top bar's fade and of the bar at the
     foot. */
  .editor :global(:is(input, textarea, button, [role='switch'])) {
    scroll-margin-top: calc(var(--fade-height) + var(--space-8));
    scroll-margin-bottom: calc(var(--bar-min) + var(--space-16));
  }
</style>
