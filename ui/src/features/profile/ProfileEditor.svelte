<!--
  The profile as a form on four tabs (Suche, Können, Erfahrung, Ausschlüsse; user decision
  2026-10-01): the sections of `sections.ts` in their order, each field as the table describes
  it, one tab shown at a time (every tab stays mounted, so what was typed stays). A tab with a
  value to put right carries a red dot, the tab of the one block the profile needs an amber
  one while a thin or new profile leaves it empty; the caret of a marked value opens its tab.
  Only Ausschlüsse and Festanstellung say in one sentence what they do (the rest is plain). Every field of a block is 32 px high, the choices too (one Segmented each), every
  control label 13/500, and every number field has one width with its unit beside it; a
  number is formatted when its field is left. A single choice (Remote-Anteil, Verfügbar ab)
  is cleared by its option "Offen". An empty optional block says "Noch leer" quietly. A value
  of the file the app could not read is said at its field with "Wert entfernen"; a value that
  is too large, a 0 where at least 1 counts, a second day below the first, a day that does not read and a value the
  backend refused are said there too, stay with their error until they change, and hold the
  save (the field gets the caret when a save is tried). Values that contradict each other say
  so quietly in the hint's place (a wished rate under the minimum, jobs for more years than
  her experience), and the remote share of permanent roles waits for their places. The
  rules for permanent roles hide while those are excluded, unless one of their values does
  not read or a save refused one (then they stay until the form is saved or discarded); the
  section folds away and unfolds again with its 32 px above it, so the sections below glide.
  The save bar rises in at the bottom of the view only while the form holds a change:
  "Speichern" (the one primary) and "Verwerfen"; it leaves once saved (the view says so in a
  toast) or discarded. While it shows, the toasts rise above it (the toast stack measures
  it). An untouched new form goes back to the ways in with Esc. Enter in a field saves, as in
  every form (in the row lists it goes to the next row, in a chip field it adds what was
  typed).
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import ChipInput from '$components/ChipInput.svelte';
  import Field from '$components/Field.svelte';
  import Notice from '$components/Notice.svelte';
  import Segmented from '$components/Segmented.svelte';
  import SettingRow from '$components/SettingRow.svelte';
  import Tabs, { type TabOption } from '$components/Tabs.svelte';
  import Toggle from '$components/Toggle.svelte';
  import { t } from '$lib/i18n/t';
  import { formKeys } from '$lib/input/input';
  import type { Notice as NoticeData, ProfileQuality, RemoteWish } from '$lib/ipc/types';
  import { MAX_YEARS, NUMBER_CRITERIA } from '$lib/ipc/types/profile';
  import { fade, rise, unfold } from '$lib/motion/transitions';
  import { primaryFirst } from '$lib/platform';
  import {
    PROFILE_TABS,
    editor,
    profileTab,
    type FieldError,
    type FieldProblem,
    type ProfileTab,
  } from '$lib/state/profile.svelte';
  import { tick, untrack } from 'svelte';
  import AskedTerms from './AskedTerms.svelte';
  import AvailableField from './AvailableField.svelte';
  import CompetenceList from './CompetenceList.svelte';
  import CountriesField from './CountriesField.svelte';
  import LanguageList from './LanguageList.svelte';
  import NumberField from './NumberField.svelte';
  import ProfileSection from './ProfileSection.svelte';
  import {
    SECTIONS,
    blank,
    controlsOf,
    fieldsOf,
    listOf,
    numberOf,
    setList,
    setNumber,
    switchField,
    tabOf,
    unitOf,
    type Control,
    type Line,
    type NumberKey,
    type Section,
  } from './sections';
  import ValueNote from './ValueNote.svelte';
  import { vocabulary } from './vocabulary.svelte';
  import WorkloadField from './WorkloadField.svelte';

  interface Props {
    /** How much the engine understands of the form as it is (guidance for a thin profile). */
    quality: ProfileQuality | null;
    /** Values of the file the app could not read that are still there. */
    problems: readonly FieldProblem[];
    /** The engine's warnings of the profile (Schwerpunkte taken over). */
    warnings: readonly NoticeData[];
    /** A value the backend refused on the last save. */
    fieldError: FieldError | null;
    busy: boolean;
    /** A failure of the last save, in words. */
    note: string | null;
    onsave: () => void;
    ondiscard: () => void;
    /** The save bar has left (after a save: the view's toast comes now). */
    onbargone?: () => void;
  }

  let { quality, problems, warnings, fieldError, busy, note, onsave, ondiscard, onbargone }: Props =
    $props();

  // Text typed into a chip field of the form counts as a change.
  editor.typed.share();

  const words = $derived(t.profile.field);
  const id = $props.id();
  const form = $derived(editor.after);

  // ------------------------------------------------------------ values that hold the save

  /** The largest value of a number of the form (the backend's limits, core). */
  const MAX: Record<NumberKey, number> = {
    ...Object.fromEntries(
      Object.entries(NUMBER_CRITERIA).map(([key, criterion]) => [key, criterion.max]),
    ),
    years: MAX_YEARS,
    wishDayRate: NUMBER_CRITERIA.minDayRate.max,
  } as Record<NumberKey, number>;

  /** Numbers where 0 is nothing a job could meet (a day rate, a duration, days a week): a
   *  typed 0 is said and holds the save instead of turning into no value unseen. */
  const AT_LEAST_ONE: readonly NumberKey[] = [
    'minDayRate',
    'wishDayRate',
    'minMonths',
    'workloadMinDays',
    'workloadMaxDays',
  ];

  /** Values the form knows are wrong before anything is sent: too large, a 0 where at least 1
   *  counts, or the second day of the workload below the first. Each is said at its field and
   *  holds the save. */
  const invalid = $derived.by((): { field: string; row: number | null; text: string }[] => {
    const found: { field: string; row: number | null; text: string }[] = [];
    for (const key of Object.keys(MAX) as NumberKey[]) {
      const value = numberOf(form, key);
      if (value !== null && value > MAX[key]) {
        found.push({ field: key, row: null, text: words.atMost(MAX[key]) });
      } else if (value === 0 && AT_LEAST_ONE.includes(key)) {
        found.push({ field: key, row: null, text: words.atLeast(1) });
      }
    }
    const { workloadMinDays: min, workloadMaxDays: max } = form.criteria;
    if (min !== null && max !== null && max < min && max <= MAX.workloadMaxDays) {
      found.push({ field: 'workloadMaxDays', row: null, text: words.workloadOrder });
    }
    // A competence's years, counted among the rows with a name (as the backend does).
    const named = form.competences.filter((row) => row.name.trim() !== '');
    const row = named.findIndex((each) => each.years !== null && each.years > MAX_YEARS);
    if (row >= 0) found.push({ field: 'competences', row, text: words.atMost(MAX_YEARS) });
    return found;
  });
  const invalidOf = (field: string): string | null =>
    invalid.find((each) => each.field === field)?.text ?? null;
  /** A value is marked: Speichern waits until it is put right. */
  const held = $derived(
    invalid.length > 0 || fieldError !== null || (editor.judged && editor.dateInvalid),
  );

  /** The words of a value the app could not read, by the kind of its field: a number that is
   *  none, or (digits out of range, anything else) a value the app cannot read. */
  function unreadText(problem: FieldProblem): string {
    if (problem.field === 'available') return words.unreadableDate(problem.value);
    if (problem.entry && problem.field === 'roles') return words.unreadableRole(problem.value);
    const number = problem.field in NUMBER_CRITERIA || problem.field === 'wishDayRate';
    return number && !/^\d+$/.test(problem.value)
      ? words.unreadableNumber(problem.value)
      : words.unreadableValue(problem.value);
  }

  const problemsOf = (field: string): FieldProblem[] =>
    problems.filter((problem) => problem.field === field);

  /** "Wert entfernen": an entry of a list goes at once, a whole value when saving. */
  function drop(problem: FieldProblem): void {
    const other = (entry: string): boolean => entry.toLowerCase() !== problem.value.toLowerCase();
    if (problem.entry && problem.field === 'roles') form.roles = form.roles.filter(other);
    else if (problem.entry && problem.field === 'focus') form.focus = form.focus.filter(other);
    else editor.clear(problem.field);
  }

  /** The error of a field: a value the backend refused, a value that is wrong as it is, else
   *  the first value of the file that does not read (said by `Field` with "Wert entfernen" as
   *  its way on). */
  function errorOf(field: string): string | null {
    if (fieldError?.field === field) return fieldError.text();
    const wrong = invalidOf(field);
    if (wrong !== null) return wrong;
    const first = problemsOf(field).find((problem) => !problem.entry);
    return first ? unreadText(first) : null;
  }

  /** A field that waits for the values it depends on (`hidden`) stays while it says
   *  something: a value of the file that did not read, a limit, a refused save. */
  function waits(c: Extract<Control, { kind: 'number' }>): boolean {
    return (c.hidden?.(form) ?? false) && errorOf(c.key) === null;
  }

  type Remove = { label: string; testid: string; onclick: () => void };
  function removeOf(field: string): Remove | null {
    if (fieldError?.field === field || invalidOf(field) !== null) return null;
    const first = problemsOf(field).find((problem) => !problem.entry);
    return first
      ? { label: words.removeValue, testid: 'value-remove', onclick: () => drop(first) }
      : null;
  }

  /** Values of the file said under a control of their own (a switch, a choice, a day, an
   *  entry of a list), each with "Wert entfernen". */
  const notesOf = (field: string, entries = false): { text: string; onremove: () => void }[] =>
    problemsOf(field)
      .filter((problem) => !entries || problem.entry)
      .map((problem) => ({ text: unreadText(problem), onremove: () => drop(problem) }));

  /** The row of a list that is marked (a refusal first, then a value that is wrong). */
  function listError(field: string): { row: number | null; text: string } | null {
    if (fieldError?.field === field) return { row: fieldError.row, text: fieldError.text() };
    const wrong = invalid.find((each) => each.field === field);
    return wrong ? { row: wrong.row, text: wrong.text } : null;
  }

  /** The workload is one field of two days (von, bis): one message for both, and "Wert
   *  entfernen" takes every value of the file behind it. A refusal or a wrong value of either
   *  day comes first, as at every field, before a value of the file that does not read. */
  const WORKLOAD = ['workloadMinDays', 'workloadMaxDays'];
  const workloadError = (): string | null =>
    (fieldError !== null && WORKLOAD.includes(fieldError.field) ? fieldError.text() : null) ??
    invalidOf('workloadMinDays') ??
    invalidOf('workloadMaxDays') ??
    errorOf('workloadMinDays') ??
    errorOf('workloadMaxDays');
  function workloadRemove(): Remove | null {
    if (WORKLOAD.includes(fieldError?.field ?? '')) return null;
    if (WORKLOAD.some((field) => invalidOf(field) !== null)) return null;
    const found = WORKLOAD.flatMap(problemsOf).filter((problem) => !problem.entry);
    return found.length === 0
      ? null
      : { label: words.removeValue, testid: 'value-remove', onclick: () => found.forEach(drop) };
  }
  const marked = (field: string): boolean =>
    fieldError?.field === field || invalidOf(field) !== null || problemsOf(field).length > 0;

  const trimmed = $derived.by((): number | null => {
    const notice = warnings.find((w) => w.code === 'focusTrimmed');
    return notice ? Number(notice.params.count) : null;
  });

  /** The remote wish, "Offen" first (no wish). */
  const OPEN = 'open';
  const REMOTE = $derived<{ id: RemoteWish | typeof OPEN; label: string }[]>([
    { id: OPEN, label: words.open },
    ...(['full', 'mostly', 'partly', 'onSite'] as const).map((wish) => ({
      id: wish,
      label: t.profile.remoteWish[wish],
    })),
  ]);

  const unreadIn = (fields: readonly string[]): boolean =>
    problems.some((problem) => fields.includes(problem.field));

  /** "Noch leer" follows one rule in every section: nothing in it while the profile is thin
   *  or new, and never above a value of the file that does not read. */
  const thin = $derived(quality === 'thin' || quality === 'empty');
  const guide = $derived(thin || editor.origin === 'new');
  function emptySection(section: Section): boolean {
    const controls = controlsOf(section.lines);
    return (
      guide &&
      controls.every((control) => blank(form, control)) &&
      !unreadIn(controls.flatMap(fieldsOf))
    );
  }

  /** A section that waits (`hidden`) and holds a value that holds the save (a save refused
   *  it, or the form marks it) stays until the form is saved or discarded, so it can be put
   *  right; one with a value of the file that does not read stays too, so the head's
   *  "n Werte prüfen" always leads to it. */
  const fieldsIn = (section: Section): string[] => controlsOf(section.lines).flatMap(fieldsOf);
  const WAITING = SECTIONS.filter((section) => section.hidden !== undefined);
  let kept = $state<string[]>([]);
  $effect(() => {
    const marked = new Set([fieldError?.field ?? '', ...invalid.map((each) => each.field)]);
    const dirty = editor.dirty;
    const now = WAITING.map((section) => ({
      id: section.id,
      refused: fieldsIn(section).some((field) => marked.has(field)),
      hidden: section.hidden?.(form) ?? false,
    }));
    untrack(() => {
      kept = now
        .filter((each) => each.refused || (kept.includes(each.id) && dirty && each.hidden))
        .map((each) => each.id);
    });
  });
  const shown = (section: Section): boolean =>
    !(section.hidden?.(form) ?? false) || kept.includes(section.id) || unreadIn(fieldsIn(section));

  /** A tab's dot: red while a value in it is to be put right, amber while the one block
   *  the profile needs is empty in a thin or new profile. */
  function markOf(tab: ProfileTab): 'danger' | 'warning' | null {
    const sections = SECTIONS.filter((section) => section.tab === tab);
    const fields = sections.flatMap(fieldsIn);
    const wrong = fields.some(
      (field) =>
        errorOf(field) !== null ||
        listError(field) !== null ||
        problemsOf(field).length > 0 ||
        (field === 'available' && editor.judged && editor.dateInvalid),
    );
    if (wrong) return 'danger';
    return sections.some((section) => section.required && emptySection(section)) ? 'warning' : null;
  }
  const tabs = $derived<TabOption<ProfileTab>[]>(
    PROFILE_TABS.map((tab) => ({
      id: tab,
      label: t.profile.tab[tab],
      mark: markOf(tab),
      testid: `profile-tab-${tab}`,
    })),
  );

  const actionFirst = primaryFirst();
  let root = $state<HTMLElement | null>(null);

  /** Ready to save: a value that holds the save is said at its field, which gets the caret. */
  export function ready(): boolean {
    editor.judged = true;
    if (editor.dateInvalid) {
      profileTab.value = tabOf('available') ?? profileTab.value;
      void tick().then(() =>
        document.querySelector<HTMLInputElement>('[data-testid="profile-date"]')?.focus(),
      );
      return false;
    }
    const wrong = invalid[0] ?? null;
    if (wrong !== null) void focusField(wrong.field);
    return wrong === null && fieldError === null;
  }

  /** The caret into the field a refused value belongs to (its marked control first), in
   *  the middle of the view; `false` when the field is not on the page. */
  export async function focusField(field: string): Promise<boolean> {
    const tab = tabOf(field === 'focus' ? 'competences' : field);
    if (tab !== null) profileTab.value = tab;
    await tick();
    const scope = root?.querySelector<HTMLElement>(`[data-field="${field}"]`);
    const target =
      scope?.querySelector<HTMLElement>('[aria-invalid="true"]') ??
      scope?.querySelector<HTMLElement>('input, textarea, button');
    target?.focus();
    target?.scrollIntoView({ block: 'center' });
    return target !== null && target !== undefined;
  }

  let bar = $state<HTMLElement | null>(null);

  /** A focused control that ends under the sticky save bar moves up (WebKit does not
   *  apply scroll-margin when it scrolls a focused field into view). */
  function keepClear(event: FocusEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    requestAnimationFrame(() => {
      const top = bar?.getBoundingClientRect().top ?? Infinity;
      if (target.isConnected && target.getBoundingClientRect().bottom > top) {
        target.scrollIntoView({ block: 'center' });
      }
    });
  }

  function save(): void {
    if (!editor.dirty || busy) return;
    if (ready()) onsave();
  }

  /** Enter in a field of the form outside it (the name and role under the title). */
  export function submit(): void {
    save();
  }

  /** A new form nothing was typed into: Esc goes back to the ways in. */
  const untouched = $derived(editor.origin === 'new' && !editor.dirty);

  const kebab = (text: string): string => text.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
</script>

<div
  class="editor"
  bind:this={root}
  use:formKeys={untouched ? { save, cancel: ondiscard } : { save }}
  onfocusin={keepClear}
  data-testid="profile-form"
>
  <div class="tabbar">
    <Tabs
      options={tabs}
      value={profileTab.value}
      label={t.profile.tabs}
      testid="profile-tabs"
      onchange={(tab) => (profileTab.value = tab)}
    />
  </div>
  {#each PROFILE_TABS as tab (tab)}
    <div
      class="panel"
      class:gone={tab !== profileTab.value}
      role="tabpanel"
      aria-label={t.profile.tab[tab]}
      data-testid="profile-panel-{tab}"
    >
      {#each SECTIONS.filter((section) => section.tab === tab) as section, index (section.id)}
        {#if shown(section)}
          <div class="section" transition:unfold>
            <div class="space">
              <ProfileSection
                heading={index === 0 ? null : t.profile.section[section.id]}
                hint={t.profile.sectionHint[section.id] ?? null}
                empty={index > 0 && emptySection(section)}
                required={section.required ?? false}
                optional={section.optional ?? false}
                testid="section-{section.id}"
              >
                {#each section.lines as line, index (index)}
                  {@render lineOf(line)}
                {/each}
              </ProfileSection>
            </div>
          </div>
        {/if}
      {/each}
    </div>
  {/each}
</div>

{#snippet lineOf(line: Line)}
  {#if line.kind === 'pair'}
    <div class="pair">
      {#each line.fields as field, index (index)}{@render control(field)}{/each}
    </div>
  {:else if line.kind === 'switches'}
    <div class="switches">
      {#each line.fields as field, index (field.key)}
        {@const value = switchField(field.key)}
        {@const off = field.off?.(form) ?? null}
        <div class="switch" data-field={value}>
          <SettingRow
            label={words[field.label]}
            hint={field.hint ? words[field.hint] : null}
            for="{id}-{field.key}"
          >
            <Toggle
              id="{id}-{field.key}"
              checked={field.key === 'remoteOutside'
                ? !form.criteria.remoteOutside
                : form.criteria[field.key]}
              label={words[field.label]}
              disabled={off !== null}
              disabledReason={off === null ? null : words[off]}
              testid={field.testid}
              onchange={(on) => {
                if (field.key === 'remoteOutside') form.criteria.remoteOutside = !on;
                else form.criteria[field.key] = on;
              }}
            />
          </SettingRow>
          <!-- What the file had behind the switches of one key, after the last of them. -->
          {#if line.fields.findLastIndex((other) => switchField(other.key) === value) === index}
            {#each notesOf(value) as unread (unread.text)}
              <ValueNote
                text={unread.text}
                testid="{kebab(value)}-unread"
                onremove={unread.onremove}
              />
            {/each}
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    {@render control(line)}
  {/if}
{/snippet}

{#snippet control(c: Control)}
  {#if c.kind === 'number' && !waits(c)}
    {@const unit = unitOf(c)}
    {@const error = errorOf(c.key)}
    {@const advice = c.advice?.(form) ?? null}
    <div data-field={c.key} transition:fade>
      <Field
        label={words[c.label]}
        for="{id}-{c.key}"
        hint={advice !== null ? words[advice] : c.hint ? words[c.hint] : null}
        {error}
        action={removeOf(c.key)}
      >
        <NumberField
          id="{id}-{c.key}"
          money={unit === 'euro'}
          unit={unit === null ? null : t.profile.unit[unit]}
          bind:value={() => numberOf(form, c.key), (value) => setNumber(form, c.key, value)}
          invalid={error !== null}
          disabled={error === null && (c.off?.(form) ?? false)}
          testid={c.testid}
        />
      </Field>
    </div>
  {:else if c.kind === 'chips'}
    {@const error = errorOf(c.key)}
    <div data-field={c.key}>
      <Field
        label={words[c.label]}
        for="{id}-{c.key}"
        hint={c.hint ? words[c.hint] : null}
        {error}
        action={removeOf(c.key)}
      >
        <ChipInput
          id="{id}-{c.key}"
          bind:values={() => listOf(form, c.key), (values) => setList(form, c.key, values)}
          split={c.lines ? 'lines' : 'list'}
          placeholder={words[c.placeholder]}
          invalid={error !== null}
          suggestions={c.suggest ? vocabulary[c.suggest] : undefined}
          testid={c.testid}
        />
      </Field>
      {#each notesOf(c.key, true) as unread (unread.text)}
        <ValueNote text={unread.text} testid="{kebab(c.key)}-unread" onremove={unread.onremove} />
      {/each}
      {#if c.asked}<AskedTerms field={c.asked} home={c.testid} />{/if}
    </div>
  {:else if c.kind === 'competences'}
    <CompetenceList
      bind:rows={form.competences}
      bind:focus={form.focus}
      problems={problemsOf('focus')}
      {trimmed}
      onclear={() => editor.clear('focus')}
      error={listError('competences') ?? listError('focus')}
    />
    <AskedTerms field="competence" home="competence-add" />
  {:else if c.kind === 'languages'}
    <LanguageList bind:rows={form.languages} error={listError('languages')} />
    <AskedTerms field="language" home="language-add" />
  {:else if c.kind === 'countries'}
    <CountriesField
      id="{id}-countries"
      bind:values={form.criteria.countries}
      error={errorOf('countries')}
      action={removeOf('countries')}
    />
  {:else if c.kind === 'available'}
    <AvailableField
      refused={fieldError?.field === 'available' ? fieldError.text() : null}
      notes={notesOf('available')}
    />
  {:else if c.kind === 'workload'}
    <WorkloadField
      id="{id}-workload"
      bind:min={form.criteria.workloadMinDays}
      bind:max={form.criteria.workloadMaxDays}
      error={workloadError()}
      action={workloadRemove()}
      invalidMin={marked('workloadMinDays')}
      invalidMax={marked('workloadMaxDays')}
    />
  {:else if c.kind === 'remote'}
    <div class="block" data-field="remote">
      <span class="label">{words.remote}</span>
      <Segmented
        options={REMOTE}
        value={form.wishes.remote ?? OPEN}
        label={words.remote}
        testid="profile-remote"
        onchange={(wish) => (form.wishes.remote = wish === OPEN ? null : wish)}
      />
      {#each notesOf('remote') as unread (unread.text)}
        <ValueNote text={unread.text} testid="remote-unread" onremove={unread.onremove} />
      {/each}
    </div>
  {/if}
{/snippet}

{#if editor.dirty}
  <div
    class="bar"
    bind:this={bar}
    data-save-bar
    data-testid="profile-save-bar"
    in:rise={{ distance: 'lg' }}
    out:fade
    onoutroend={() => onbargone?.()}
  >
    <div class="status">
      {#if note}
        <Notice tone="danger" variant="inline" text={note} testid="profile-save-error" />
      {/if}
    </div>
    <div class="buttons">
      {#snippet discard()}
        <Button
          variant="secondary"
          size="field"
          label={t.profile.discard}
          disabled={busy}
          testid="profile-discard"
          onclick={ondiscard}
        />
      {/snippet}
      {#if !actionFirst}{@render discard()}{/if}
      <Button
        variant="primary"
        size="field"
        label={t.profile.save}
        disabled={held}
        disabledReason={t.profile.fixFirst}
        loading={busy}
        testid="profile-save"
        onclick={save}
      />
      {#if actionFirst}{@render discard()}{/if}
    </div>
  </div>
{/if}

<style>
  /* The sections 32 apart: each brings the space above it along inside the box that folds
     (a gap or a padding of that box would jump when a section folds away). */
  .editor {
    display: flex;
    flex-direction: column;
  }

  .section,
  .space,
  .panel {
    display: flex;
    flex-direction: column;
  }

  /* The tabs on their own line at the left, 24 above the first card. */
  .tabbar {
    display: flex;
    margin-bottom: var(--space-24);
  }

  .panel.gone {
    display: none;
  }

  .section + .section > .space {
    padding-top: var(--space-32);
  }

  .pair {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
    gap: var(--space-16);
  }

  @container (width >= 520px) {
    .pair {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
  }

  .block {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-6);
    min-width: 0;
  }

  /* The label of a choice, like every control label of the form (13/500). */
  .label {
    color: var(--text);
    font: var(--type-sm);
    font-weight: var(--weight-medium);
  }

  /* The switches are one list between two hairlines: each row but the last has its own
     (the wrappers that name a row's field take no box of their own). */
  .switches {
    display: flex;
    flex-direction: column;
    border-top: var(--border-width) solid var(--border);
    border-bottom: var(--border-width) solid var(--border);
  }

  .switch {
    display: contents;
  }

  .switches > .switch :global([data-setting-row]) {
    border-bottom: var(--border-width) solid var(--border);
  }

  .switches > .switch:last-child :global([data-setting-row]:last-of-type) {
    border-bottom: 0;
  }

  /* The save bar stays in view at the bottom of the scrolling view while there is a
     change; under a short tab it still stands at the bottom (the page is at least as high
     as the view), so a note that appears above never moves it under the pointer. */
  .bar {
    position: sticky;
    z-index: var(--z-sticky);
    bottom: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-12);
    margin-top: auto;
    padding: var(--space-12) 0;
    border-top: var(--border-width) solid var(--border);
    background-color: var(--surface);
  }

  .status {
    flex: 1;
    min-width: 0;
  }

  /* Tab and focus scrolling keep a field clear of the sticky save bar. */
  .editor :global(:is(input, textarea, button, [role='switch'])) {
    scroll-margin-top: var(--pane-padding);
    scroll-margin-bottom: calc(var(--control-field) + 2 * var(--space-12) + var(--space-8));
  }

  .buttons {
    display: flex;
    gap: var(--space-12);
  }
</style>
