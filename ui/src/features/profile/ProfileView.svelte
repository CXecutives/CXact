<!--
  Profil (the round 10 draft): one page in the pages' frame (Page) with its head (ProfileHead:
  the title "Profil" and "Aus Lebenslauf ausfüllen", which opens the file dialog at once). A
  CV dropped on the page (Tauri's drag and drop, never a path) is evaluated the same way,
  with a dashed edge while it is over the page; it fills the profile at once. Under the head
  what went wrong with the CV (a state box with its way out), then the four groups
  (ProfileEditor). While the form holds a change, or the last save failed, the bar at the
  foot says so (SaveBar): "Ungespeicherte Änderungen", Verwerfen and Speichern (the view's
  one primary). Without a profile the two ways in (ProfileStart); a file that no longer
  reads says so in the same place, with its folder at hand. A save is answered by a toast
  with what its rescore changed (saveEffect.ts), nothing else moves on the page. Leaving the
  view or closing the window with unsaved changes asks once ("Änderungen speichern?", the
  heading alone).
  What is missing (decisions 2 and 3 of round 10): a required field that is still empty
  (Wunschrollen, Länder, Kompetenzen, Sprachen) is red on the Profil page for as long as it
  is empty; it never holds the save. Speichern with gaps saves, says so in a plain toast (no
  success sign) and brings the first red field into view (no caret). Only a value that is
  wrong holds the save, said at its field, and Speichern's tooltip names it. A new or
  changed form asks core what it still lacks (`profileMissing`, a moment after the last
  edit), the stored profile names its own (`missing`).
  In the setup (`setup`) the same form without the CV, the bar and "Häufig verlangt"; the red
  marks show only once its "Weiter" (`next`) asked, which brings the first into view and goes
  on once nothing is missing; a failed save says so above the form.
-->
<script lang="ts">
  import Dialog from '$components/Dialog.svelte';
  import Page from '$components/Page.svelte';
  import StateBox from '$components/StateBox.svelte';
  import { t } from '$lib/i18n/t';
  import { errorText } from '$lib/i18n/texts';
  import { invoke, onCloseRequested, onFileDrag, type FileDrag } from '$lib/ipc/api';
  import type { ProfileForm } from '$lib/ipc/types';
  import { app } from '$lib/state/app.svelte';
  import { jobs } from '$lib/state/jobs.svelte';
  import { navigation, type ViewId } from '$lib/state/navigation.svelte';
  import { editor, sameForm } from '$lib/state/profile.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import { onMount, tick, untrack } from 'svelte';
  import { fromCv } from '../shared/fromCv.svelte';
  import CvProblem from './CvProblem.svelte';
  import { draftMissing } from './draftMissing.svelte';
  import ProfileEditor, { type FieldError } from './ProfileEditor.svelte';
  import ProfileHead from './ProfileHead.svelte';
  import ProfileStart from './ProfileStart.svelte';
  import SaveBar from './SaveBar.svelte';
  import { refused, watchSave } from './saveEffect';
  import { FIELD_ORDER, blank } from './sections';

  interface Props {
    /** The setup's page: the form alone, its "Weiter" saves (`next`). */
    setup?: boolean;
  }
  let { setup = false }: Props = $props();

  const profile = $derived(app.state?.profile ?? null);
  const stored = $derived(profile?.form ?? null);

  let busy = $state(false);
  /** A failure is said when it shows. */
  type Words = () => string;
  let note = $state<Words | null>(null);
  let saveNote = $state<Words | null>(null);
  /** A value the backend refused on the last save, said at its field. */
  let fieldError = $state<FieldError | null>(null);
  /** The refused field's value then, as text. */
  let refusedValue: string | null = null;
  const valueText = (form: ProfileForm, field: string): string =>
    JSON.stringify((form as Record<string, unknown>)[field] ?? null);
  // A refused value stays with its error until that value changes.
  $effect(() => {
    const error = fieldError;
    if (error === null) return;
    const now = valueText(editor.after, error.field);
    untrack(() => {
      if (refusedValue === null) refusedValue = now;
      else if (now !== refusedValue) fieldError = null;
    });
  });

  /** Where the user wanted to go with unsaved changes: a view, or closing the window. */
  let leaving = $state<ViewId | 'close' | null>(null);

  // The stored profile fills the form while nothing unsaved is in it (also after a save).
  $effect(() => {
    const form = stored;
    untrack(() => {
      if (editor.dirty || editor.origin === 'new') return;
      if (form === null) {
        if (editor.origin === 'stored') editor.close();
      } else if (editor.origin !== 'stored' || !sameForm(editor.before, form)) {
        editor.edit(form);
      }
    });
  });

  // The window asks before it closes while the form holds unsaved changes (main.rs).
  const dirty = $derived(editor.dirty);
  $effect(() => {
    const on = dirty;
    untrack(() => void invoke('set_unsaved', { on }).catch(() => undefined));
  });

  /** The window is to close with unsaved changes: the page says it is here, then asks. */
  async function closeRequested(): Promise<void> {
    await invoke('set_unsaved', { on: editor.dirty }).catch(() => undefined);
    if (editor.dirty) leaving = 'close';
    else closeWindow();
  }

  function closeWindow(): void {
    invoke('close_window').catch((error: unknown) => (note = () => errorText(error)));
  }

  onMount(() => {
    // The setup's form starts empty where there is no profile yet.
    if (setup && editor.origin === null) editor.create();
    const release = navigation.guard((next) => {
      if (!editor.dirty) return true;
      leaving = next;
      return false;
    });
    const stopClose = onCloseRequested(() => void closeRequested());
    // The setup takes its CV on its own upload step.
    const stopDrag = setup ? () => undefined : onFileDrag(dragged);
    return () => {
      release();
      stopClose();
      stopDrag();
      fromCv.clear();
      void invoke('set_unsaved', { on: false }).catch(() => undefined);
      // An untouched new form starts over next time.
      if (!editor.dirty && editor.origin !== 'stored') editor.close();
    };
  });

  /** The state again after a change; `false` when it could not be loaded. */
  async function reload(): Promise<boolean> {
    const loaded = await app.load();
    void jobs.load(true);
    void jobs.loadOverview();
    return loaded !== null;
  }

  function openFolder(): void {
    note = null;
    invoke('open_target', { target: { kind: 'profileDir' } }).catch(
      (error: unknown) => (note = () => errorText(error)),
    );
  }

  /** "Selbst ausfüllen": the new form, the caret in the wished roles. */
  async function create(): Promise<void> {
    fromCv.clear();
    editor.create();
    await caretTo('profile-roles');
  }

  /** The CV filled the profile: the form shows it as stored. */
  function filled(form: ProfileForm | null): void {
    editor.typed.clear();
    if (form !== null) editor.edit(form);
  }

  async function fillFromCv(dropped = false): Promise<void> {
    const info = await fromCv.run(dropped);
    if (info !== null) filled(info.form);
  }

  /** A file over the page that the CV import would take now. */
  let over = $state(false);
  const takesDrop = (): boolean => !editor.dirty && !fromCv.busy && !fromCv.limited;

  function dragged(drag: FileDrag): void {
    over = drag.kind === 'over' && takesDrop();
    if (drag.kind === 'drop' && drag.paths.length > 0 && takesDrop()) void fillFromCv(true);
  }

  /** The caret into a field that has just appeared (the input of a chip field). */
  async function caretTo(testid: string): Promise<void> {
    await tick();
    const node = document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
    const target = node?.matches('input, textarea, button') ? node : node?.querySelector('input');
    target?.focus();
  }

  let panel = $state<ProfileEditor | null>(null);

  /** `true` when the profile is saved. */
  async function save(): Promise<boolean> {
    busy = true;
    saveNote = null;
    fieldError = null;
    refusedValue = null;
    const effect = watchSave();
    try {
      const info = await editor.save();
      // The saved profile is the answer of the save: a state that could not be loaded
      // again never puts the old values back.
      if (!(await reload()) && app.state) app.state.profile = info;
      const form = info.form ?? app.state?.profile?.form;
      if (form) editor.edit(form);
      else editor.close();
      // The setup's next step is its answer there; with gaps the toast has no success sign.
      if (!setup) {
        const kind = missing.length > 0 ? 'plain' : 'success';
        void effect.said().then((text) => toasts.show(text, kind));
      } else effect.stop();
      return true;
    } catch (error) {
      effect.stop();
      const at = refused(error);
      if (at === null) {
        saveNote = () => errorText(error);
      } else {
        // Said at its field; the bar says it where the field is not on the page.
        fieldError = {
          field: at.field,
          row: at.row,
          text: () => (at.max !== null ? t.profile.field.atMost(at.max) : t.profile.field.refused),
        };
        if (!(await panel?.focusField(at.field))) saveNote = () => errorText(error);
      }
      return false;
    } finally {
      busy = false;
    }
  }

  /** Fertig and Speichern (and Enter in a field): a value that holds the save is said
   *  first; with gaps the profile is saved anyway and the first red field comes into view.
   *  `true` once the profile is saved, or when there was nothing to save. */
  async function trySave(): Promise<boolean> {
    if (busy) return false;
    if (!editor.dirty) return true;
    if (!panel?.ready()) return false;
    const done = await save();
    if (done && missing.length > 0) void reveal(missing[0]!);
    return done;
  }

  /** The facts under the wished roles in the head: day rate, work mode, availability,
   *  countries (a value not given stays away). */
  const facts = $derived.by(() => {
    if (editor.origin !== 'stored') return [];
    const form = editor.after;
    const shown: { icon: 'rate' | 'remote' | 'start' | 'place'; text: string; field: string }[] =
      [];
    if (form.dayRateWish !== null || form.dayRateMin !== null) {
      shown.push({
        icon: 'rate',
        text: t.profile.fact.rate(form.dayRateWish, form.dayRateMin),
        field: form.dayRateWish !== null ? 'dayRateWish' : 'dayRateMin',
      });
    }
    if (form.workMode !== 'any') {
      shown.push({ icon: 'remote', text: t.profile.workMode[form.workMode], field: 'workMode' });
    }
    shown.push({
      icon: 'start',
      text:
        form.available.kind === 'from'
          ? t.profile.read.from(form.available.date)
          : t.profile.fact.now,
      field: 'available',
    });
    if (form.countries.length > 0) {
      shown.push({
        icon: 'place',
        text: form.countries.map((code) => t.profile.country[code] ?? code).join(', '),
        field: 'countries',
      });
    }
    return shown;
  });

  /** Back to the stored profile, or (a new form) to the ways in, whose first one takes the
   *  focus of the gone form. */
  function discard(): void {
    saveNote = null;
    fieldError = null;
    flagged = false;
    editor.discard(stored);
    if (editor.origin === null) void caretTo('way-cv');
  }

  /** Leaving without saving. */
  function leave(): void {
    const next = leaving;
    leaving = null;
    editor.discard(stored);
    if (next === 'close') closeWindow();
    else if (next !== null) navigation.go(next, true);
  }

  /** Saving, then leaving; a date that does not read or a failed save keeps the view. */
  async function saveAndLeave(): Promise<void> {
    const next = leaving;
    if (panel !== null && !panel.ready()) {
      leaving = null;
      return;
    }
    const done = await save();
    leaving = null;
    if (!done || next === null) return;
    if (next === 'close') closeWindow();
    else navigation.go(next, true);
  }

  // ------------------------------------------------------------ what is still missing

  /** What core says a new or changed form still lacks. */
  const draft = draftMissing();

  /** The required fields still empty, in the order of the page: core names them (for a new
   *  or changed form on asking, else for the stored profile), the form drops those filled
   *  since at once. */
  const missing = $derived(
    FIELD_ORDER.filter(
      (field) =>
        (draft.fields() ?? profile?.missing ?? []).includes(field) && blank(editor.after, field),
    ),
  );
  /** The setup's Weiter asked for them: from then on they are marked until they are filled
   *  (the Profil page marks them always). */
  let flagged = $state(false);
  $effect(() => {
    if (flagged && missing.length === 0) flagged = false;
  });
  const marked = $derived(!setup || flagged ? missing : []);

  /** A field of the form in the middle of the view, no caret (Weiter, Speichern). */
  function reveal(field: string): Promise<boolean> {
    return panel?.revealField(field) ?? Promise.resolve(false);
  }

  /** The Profil opened for one of its fields ("Profil ergänzen" in the Jobs view sets
   *  `navigation.section` to the first required field still empty; read once and set back,
   *  like Einstellungen its group): that field comes into view. */
  $effect(() => {
    const field = navigation.section;
    if (field === null || setup || panel === null) return;
    navigation.section = null;
    void tick().then(() => reveal(field));
  });

  /**
   * The setup's "Weiter": what is missing is marked and the first one scrolls into view;
   * else it saves what changed (a new form always) and is `true` once nothing required is
   * open in the stored profile.
   */
  export async function next(): Promise<boolean> {
    if (busy) return false;
    if (missing.length > 0) {
      flagged = true;
      void reveal(missing[0]!);
      return false;
    }
    if (editor.dirty || editor.origin === 'new') {
      if (panel !== null && !panel.ready()) return false;
      if (!(await save())) return false;
    }
    const left = FIELD_ORDER.filter((field) => (profile?.missing ?? []).includes(field));
    if (profile === null || left.length > 0) {
      flagged = true;
      void reveal(left[0] ?? FIELD_ORDER[0] ?? '');
      return false;
    }
    return true;
  }

  /** The bar at the foot, for a form that was never stored (a stored profile saves group by
   *  group with Fertig): a change or a failed save. */
  const barShown = $derived(editor.origin === 'new' && (editor.dirty || saveNote !== null));
</script>

{#snippet notes()}
  {#if !setup}<CvProblem />{/if}
  {#if note}<StateBox heading={note()} alert testid="profile-note" />{/if}
  {#if !setup && !barShown && saveNote}
    <StateBox heading={saveNote()} alert testid="profile-save-error" />
  {/if}
{/snippet}

{#if app.state === null}
  <!-- The shell shows nothing until the state is known. -->
{:else if setup}
  {#if editor.origin !== null}
    <div class="setup" data-testid="profile">
      {@render notes()}
      {#if saveNote}
        <StateBox heading={saveNote()} alert testid="profile-save-error" />
      {/if}
      <ProfileEditor
        bind:this={panel}
        setup
        {fieldError}
        missing={marked}
        onsave={() => void next()}
        ondiscard={discard}
      />
    </div>
  {/if}
{:else}
  {#snippet head()}
    <ProfileHead
      heading={editor.origin === null && profile?.parseError ? t.profile.unreadable : t.nav.profile}
      form={editor.origin !== null}
      dirty={editor.dirty}
      oncv={() => void fillFromCv()}
      onfolder={editor.origin === null && profile?.parseError ? openFolder : null}
      roles={editor.origin === 'stored'
        ? editor.after.roles.filter((role) => role.trim() !== '')
        : []}
      {facts}
      onfact={(field) => panel?.openAt(field)}
    />
  {/snippet}
  {#snippet bar()}
    <SaveBar
      dirty={editor.dirty}
      {busy}
      wrong={panel?.wrongField() ?? null}
      failure={saveNote?.() ?? null}
      onsave={() => void trySave()}
      ondiscard={discard}
    />
  {/snippet}
  <Page testid="profile" {over} {head} foot={barShown && editor.origin !== null ? bar : null}>
    {#if editor.origin === null}
      <ProfileStart
        text={profile?.parseError
          ? `${t.error.text(profile.parseError.kind, profile.parseError.params)} ${t.profile.replaces}`
          : t.profile.noneText}
        note={note?.() ?? null}
        onfilled={(info) => filled(info.form)}
        onempty={() => void create()}
      />
    {:else}
      {@render notes()}
      <ProfileEditor
        bind:this={panel}
        {fieldError}
        missing={marked}
        {busy}
        onsave={trySave}
        ondiscard={discard}
      />
    {/if}
  </Page>
{/if}

<!-- The heading says it all: the dialog does not repeat it. -->
<Dialog
  open={leaving !== null}
  heading={t.profile.leaveHeading}
  confirmLabel={t.profile.save}
  altLabel={t.profile.discard}
  {busy}
  testid="dialog-leave-profile"
  onconfirm={() => void saveAndLeave()}
  onalt={leave}
  oncancel={() => (leaving = null)}
/>

<style>
  .setup {
    display: flex;
    flex-direction: column;
    gap: var(--space-16);
  }
</style>
