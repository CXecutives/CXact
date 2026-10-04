<!--
  Profil: the one profile of the app as one airy page (design B) under the view's head
  (PageHeader, it scrolls with the page under the top bar's fade): "Profil" at the left, "Aus
  Lebenslauf ausfüllen" with its popover at the right (ProfileActions). A CV dropped anywhere
  on the page (Tauri's drag and drop of the window, the same path as the setup's upload; the
  page never sends a path) is evaluated the same way while that button would take it; the
  page shows a dashed edge while such a file is over it. The CV fills the profile at once
  ("Profil ausgefüllt. Bitte prüfen.").
  Under the head the column (600): what went wrong with the CV or the last save, the rescore
  a save started, and the three sections. While the form holds a change a dark bar floats at
  the foot (SaveBar): "Ungespeicherte Änderungen", Verwerfen and Speichern (the view's one
  primary). Without a profile the two ways in (ProfileStart); a file that no longer reads says
  so in the same place, with its folder at hand. A save is answered by a toast with what its
  rescore changed (saveEffect.ts). Leaving the view or closing the window with unsaved
  changes asks once ("Änderungen speichern?", the heading alone).
  What is missing (design round 4): nothing warns up front. Speichern saves anyway; while
  required fields are still empty they then get the amber edge and halo, the caret goes to
  the first one and the floating bar says "Es fehlt noch …" (the names lead to their fields)
  until they are filled. A new or changed form asks core what it still lacks
  (`profileMissing`, a moment after the last edit), the stored profile names its own
  (`missing`).
  In the setup (`setup`) the page is the same form without the head, the bar and "Häufig
  verlangt"; the setup's "Weiter" (`next`) marks what is missing the same way and goes on only
  once nothing is (`onflag` hands the sentence's names to the setup's foot); Esc does
  nothing; closing the window with unsaved changes still asks.
-->
<script lang="ts" module>
  /** A required field that is still empty, with its name. */
  export type MissingField = { field: string; name: string };
</script>

<script lang="ts">
  import Dialog from '$components/Dialog.svelte';
  import Notice from '$components/Notice.svelte';
  import PageHeader from '$components/PageHeader.svelte';
  import Spinner from '$components/Spinner.svelte';
  import { t } from '$lib/i18n/t';
  import { errorText } from '$lib/i18n/texts';
  import { invoke, onCloseRequested, onFileDrag, type FileDrag } from '$lib/ipc/api';
  import type { ProfileForm } from '$lib/ipc/types';
  import { app } from '$lib/state/app.svelte';
  import { jobs } from '$lib/state/jobs.svelte';
  import { navigation, type ViewId } from '$lib/state/navigation.svelte';
  import { editor, sameForm } from '$lib/state/profile.svelte';
  import { run } from '$lib/state/run.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import { onMount, tick, untrack } from 'svelte';
  import { fromCv } from '../shared/fromCv.svelte';
  import { draftMissing } from './draftMissing.svelte';
  import ProfileActions from './ProfileActions.svelte';
  import ProfileEditor, { type FieldError } from './ProfileEditor.svelte';
  import ProfileStart from './ProfileStart.svelte';
  import SaveBar from './SaveBar.svelte';
  import { refused, watchSave } from './saveEffect';
  import { FIELD_ORDER, blank } from './sections';

  interface Props {
    /** The setup's page: the form alone, its "Weiter" saves (`next`). */
    setup?: boolean;
    /** The fields the missing sentence names once a press asked for them (null: none). */
    onflag?: (fields: readonly MissingField[] | null) => void;
  }
  let { setup = false, onflag }: Props = $props();

  const profile = $derived(app.state?.profile ?? null);
  const stored = $derived(profile?.form ?? null);
  const rescoring = $derived((run.active && run.kind === 'rescore') || (profile?.pending ?? 0) > 0);

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
      // The setup's next step is its answer there.
      if (!setup) void effect.said().then((text) => toasts.show(text, 'success'));
      else effect.stop();
      return true;
    } catch (error) {
      effect.stop();
      const at = refused(error);
      if (at === null) {
        saveNote = () => errorText(error);
      } else {
        // Said at its field without its name again; the bar says it where the field is not
        // on the page.
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

  /** "Speichern" (and Enter in a field): a value that holds the save is said first; what is
   *  missing is marked, and the profile is saved anyway. */
  async function trySave(): Promise<void> {
    if (!editor.dirty || busy) return;
    if (!panel?.ready()) return;
    const open = missing.length > 0;
    if (open) flagged = true;
    const done = await save();
    if (done && open && missing.length > 0) void jump(missing[0]!, false);
  }

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
  /** A press asked for them (Speichern, the setup's Weiter): they are marked and said until
   *  they are filled. */
  let flagged = $state(false);
  $effect(() => {
    if (flagged && missing.length === 0) flagged = false;
  });
  const marked = $derived(flagged ? missing : []);
  /** Their names (each field's label). */
  const markedNames = $derived(
    marked.map((field) => ({
      field,
      name: (t.profile.field as Record<string, unknown>)[field] as string,
    })),
  );
  $effect(() => {
    onflag?.(markedNames.length === 0 ? null : markedNames);
  });

  /** A field of the form: the caret in it (with `flash` it lights up once). */
  export function jump(field: string, flash = true): Promise<boolean> {
    return panel?.focusField(field, flash) ?? Promise.resolve(false);
  }

  /**
   * The setup's "Weiter": what is missing is marked and the caret goes to the first one;
   * else it saves what changed (a new form always) and is `true` once nothing required is
   * open in the stored profile.
   */
  export async function next(): Promise<boolean> {
    if (busy) return false;
    if (missing.length > 0) {
      flagged = true;
      void jump(missing[0]!, false);
      return false;
    }
    if (editor.dirty || editor.origin === 'new') {
      if (panel !== null && !panel.ready()) return false;
      if (!(await save())) return false;
    }
    const left = FIELD_ORDER.filter((field) => (profile?.missing ?? []).includes(field));
    if (profile === null || left.length > 0) {
      flagged = true;
      void jump(left[0] ?? FIELD_ORDER[0] ?? '', false);
      return false;
    }
    return true;
  }

  /** The floating bar: a change, a failed save, or what is missing after a save. */
  const barShown = $derived(editor.dirty || saveNote !== null || marked.length > 0);
</script>

{#snippet notes()}
  {#if fromCv.problem && !setup}
    {@const problem = fromCv.problem}
    <Notice
      tone="danger"
      variant="inline"
      text={problem.text()}
      action={problem.again
        ? { label: problem.again(), testid: 'cv-again', onclick: () => void fillFromCv() }
        : null}
      testid="cv-error"
    />
  {/if}
  {#if note}<Notice tone="danger" variant="inline" text={note()} testid="profile-note" />{/if}
  {#if rescoring && !setup}
    <p class="quiet" data-testid="profile-rescoring">
      <Spinner size="sm" label={null} />{t.profile.rescoring(profile?.pending ?? 0)}
    </p>
  {/if}
{/snippet}

{#if app.state === null}
  <!-- The shell shows nothing until the state is known. -->
{:else if setup}
  {#if editor.origin !== null}
    <div class="setup" data-testid="profile">
      {@render notes()}
      {#if saveNote}
        <Notice tone="danger" variant="inline" text={saveNote()} testid="profile-save-error" />
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
  <div class="page" class:over data-testid="profile">
    <PageHeader
      heading={editor.origin === null && profile?.parseError
        ? t.profile.unreadable
        : t.profile.title}
      headingTestid="profile-heading"
      column="page"
      testid="profile-head"
    >
      {#snippet actions()}
        {#if editor.origin !== null}
          <ProfileActions dirty={editor.dirty} oncv={() => void fillFromCv()} />
        {/if}
      {/snippet}
    </PageHeader>
    <div class="body">
      {#if editor.origin === null}
        <ProfileStart
          text={profile?.parseError
            ? `${t.error.text(profile.parseError.kind, profile.parseError.params)} ${t.profile.replaces}`
            : t.profile.noneText}
          unreadable={(profile?.parseError ?? null) !== null}
          note={note?.() ?? null}
          onfilled={(info) => filled(info.form)}
          onempty={() => void create()}
          onopenfolder={openFolder}
        />
      {:else}
        {@render notes()}
        <ProfileEditor
          bind:this={panel}
          {fieldError}
          missing={marked}
          onsave={() => void trySave()}
          ondiscard={discard}
        />
      {/if}
    </div>
    {#if barShown && editor.origin !== null}
      <SaveBar
        dirty={editor.dirty}
        {busy}
        held={panel?.held() ?? false}
        failure={saveNote?.() ?? null}
        missing={markedNames}
        onjump={(field) => void jump(field)}
        onsave={() => void trySave()}
        ondiscard={discard}
      />
    {/if}
  </div>
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
  /* At least as high as the view, so the floating bar stands at its foot under a short page. */
  .page {
    display: flex;
    flex-direction: column;
    min-height: 100%;
  }

  /* The column under the head: 600 wide, centred, the room of the page's end below. */
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-16);
    width: 100%;
    max-width: calc(var(--page-width) + 2 * var(--pane-padding));
    margin: 0 auto;
    padding: var(--space-8) var(--pane-padding) var(--page-end);
  }

  /* With the floating bar, the bar ends the page: its own room replaces the page's end. */
  .page:has(> :global([data-testid='profile-save-bar'])) .body {
    padding-bottom: 0;
  }

  /* A CV over the page: a dashed edge inside the view. */
  .page.over {
    border-radius: var(--radius-lg);
    outline: var(--drop-edge) dashed var(--border-strong);
    outline-offset: calc(-1 * var(--space-8));
  }

  .setup {
    display: flex;
    flex-direction: column;
    gap: var(--space-16);
  }

  .quiet {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    color: var(--text-muted);
    font: var(--type-sm);
  }
</style>
