<!--
  Profil (the round 10 draft): one page in the pages' frame (Page) with its head (ProfileHead:
  the title "Profil" and "Aus Lebenslauf ausfüllen", which opens the file dialog at once). A
  CV dropped on the page (Tauri's drag and drop, never a path) is evaluated the same way,
  with a dashed edge while it is over the page; it fills the profile at once. Under the head
  what went wrong with the CV (a state box with its way out), then the groups
  (ProfileEditor). Without a profile the two ways in (ProfileStart); a file that no longer
  reads says so in the same place, with its folder at hand.
  A change saves by itself, like a setting (owner, 2026-10-30): a moment after a control
  changed, a text field once it is left or with Enter, and before the view is left or the
  window closes. Nothing asks and nothing bars the way, and nothing is said unless the rescore
  of the save moved jobs (a toast, saveEffect.ts). What changes while a save is under way goes
  next; a save that failed says so under the head and is tried again with the next change or
  the next way out. A value that is wrong holds the save, said at its field; leaving with one,
  or with a save that failed, asks once whether to drop it, and nothing is saved behind the
  question.
  What is missing (owner, 2026-10-29): a required field that is still empty (Wunschrollen,
  Länder, Kompetenzen, Sprachen) never holds the save and stays calm on the Profil page. The
  card under the head names them, its "Ergänzen" brings the first up under the top bar (no
  caret). A new or changed form asks core what it still lacks
  (`profileMissing`, a moment after the last edit), the stored profile names its own
  (`missing`).
  In the setup (`setup`) the same form without the CV and the card; its "Weiter" (`next`)
  saves. The red marks show only once it asked, which brings the first into view and goes on
  once nothing is missing; a failed save says so above the form.
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
  import { tokenMs } from '$lib/tokens';
  import { onMount, tick, untrack } from 'svelte';
  import { fromCv } from '../shared/fromCv.svelte';
  import CvProblem from './CvProblem.svelte';
  import { draftMissing } from './draftMissing.svelte';
  import ProfileEditor, { type FieldError } from './ProfileEditor.svelte';
  import ProfileHead from './ProfileHead.svelte';
  import ProfileStart from './ProfileStart.svelte';
  import { refused, watchSave, type SaveEffect } from './saveEffect';
  import { FIELD_ORDER, LABEL_OF } from './sections';

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

  /** Where the way out leads while the form is saved or the question stands: a view, or closing
   *  the window (a second way only changes where it leads). */
  let leaving: ViewId | 'close' | null = null;
  /** A change cannot be saved: the question whether to drop it stands. */
  let asking = $state(false);

  // The stored profile fills the form while nothing unsaved is in it. A save under way decides
  // at its end (`editor.settle`): till then a change taken back reads as none.
  $effect(() => {
    const form = stored;
    untrack(() => {
      if (busy || editor.dirty || editor.origin === 'new') return;
      if (form === null) {
        if (editor.origin === 'stored') editor.close();
      } else if (editor.origin !== 'stored' || !sameForm(editor.before, form)) {
        editor.edit(form);
      }
    });
  });

  // The window (main.rs) and a way out wait while the form holds unsaved changes; a save under
  // way counts, as what was taken back meanwhile goes after it.
  const dirty = $derived(editor.dirty || busy);
  $effect(() => {
    const on = dirty;
    untrack(() => void invoke('set_unsaved', { on }).catch(() => undefined));
  });

  function closeWindow(): void {
    invoke('close_window').catch((error: unknown) => (note = () => errorText(error)));
  }

  /** The way goes on to where it leads. */
  function goOn(): void {
    const next = leaving;
    leaving = null;
    asking = false;
    if (next === 'close') closeWindow();
    else if (next !== null) navigation.go(next, true);
  }

  /** Leaves once what the form holds is saved; a change that cannot be saved asks first. */
  async function leaveTo(next: ViewId | 'close'): Promise<void> {
    const going = leaving !== null;
    leaving = next;
    if (going) return;
    clearTimeout(timer);
    if (await settled()) goOn();
    else asking = true;
  }

  /** The window is to close: the page says it is here, then saves. */
  async function closeRequested(): Promise<void> {
    await invoke('set_unsaved', { on: dirty }).catch(() => undefined);
    await leaveTo('close');
  }

  /** The change that cannot be saved goes, and the way goes on. */
  function leave(): void {
    saveNote = null;
    fieldError = null;
    editor.discard(stored);
    goOn();
  }

  /** Staying: what waited for the way goes with it; what holds the save is said at its field,
   *  which comes into view. */
  function stay(): void {
    leaving = null;
    asking = false;
    navigation.stay();
    panel?.ready();
  }

  /** A moment after a change, and when a field was left; not on a way out, which saves first
   *  and then stands at its question. */
  let timer: ReturnType<typeof setTimeout> | undefined;
  function soon(): void {
    clearTimeout(timer);
    if (leaving !== null) return;
    timer = setTimeout(() => {
      if (!typing()) void trySave();
    }, tokenMs('--save-delay'));
  }

  /** The caret stands in a field of the form: its value is not done yet. */
  function typing(): boolean {
    const active = document.activeElement;
    return (
      document.hasFocus() &&
      active instanceof HTMLElement &&
      active.matches('input, textarea') &&
      active.closest('[data-testid="profile-form"]') !== null
    );
  }

  $effect(() => {
    if (!setup && editor.changed) untrack(soon);
  });

  onMount(() => {
    // The setup's form starts empty where there is no profile yet.
    if (setup && editor.origin === null) editor.create();
    const release = navigation.guard((next) => {
      if (!dirty) return true;
      void leaveTo(next);
      return false;
    });
    const stopClose = onCloseRequested(() => void closeRequested());
    // The setup takes its CV on its own upload step.
    const stopDrag = setup ? () => undefined : onFileDrag(dragged);
    return () => {
      clearTimeout(timer);
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

  /** "Selbst ausfüllen": the new form. */
  function create(): void {
    fromCv.clear();
    editor.create();
  }

  /** The CV filled the profile: the form shows it as stored. */
  function filled(form: ProfileForm | null): void {
    editor.typed.clear();
    if (form !== null) editor.edit(form);
  }

  async function fillFromCv(dropped = false): Promise<void> {
    if (!(await settled())) return;
    const info = await fromCv.run(dropped);
    if (info !== null) filled(info.form);
  }

  let panel = $state<ProfileEditor | null>(null);

  /** The label of a value that holds the save. */
  const held = $derived(panel?.wrongField() ?? null);

  /** A file over the page: the dashed edge shows while the CV import would take it; a drop it
   *  cannot take says why (the tries used up, in fromCv; a value that is wrong). */
  let over = $state(false);
  const takesDrop = (): boolean =>
    leaving === null && held === null && !fromCv.busy && !fromCv.limited;

  function dragged(drag: FileDrag): void {
    over = drag.kind === 'over' && takesDrop();
    if (drag.kind !== 'drop' || drag.paths.length === 0 || leaving !== null) return;
    const wrong = held;
    if (wrong !== null) saveNote = () => t.profile.fixFirst(wrong);
    else void fillFromCv(true);
  }

  /** Back at the ways in, the keyboard focus on the first of them (a button: no caret). */
  async function focusFirstWay(): Promise<void> {
    await tick();
    document.querySelector<HTMLElement>('[data-testid="way-cv"]')?.focus();
  }

  /** The toast of the last save, until the next one takes over. */
  let lastSave: SaveEffect | null = null;

  /** The last save, done or still under way, and whether it saved. */
  let lastWrite: Promise<boolean> = Promise.resolve(true);

  /** `true` when the profile is saved. */
  function save(): Promise<boolean> {
    lastWrite = write();
    return lastWrite;
  }

  /** One save: the form goes, the state comes back and the form settles on it. */
  async function write(): Promise<boolean> {
    busy = true;
    saveNote = null;
    fieldError = null;
    refusedValue = null;
    lastSave?.stop();
    const watching = watchSave();
    lastSave = watching;
    try {
      const info = await editor.save();
      // The saved profile is the answer of the save: a state that could not be loaded
      // again never puts the old values back.
      if (!(await reload()) && app.state) app.state.profile = info;
      const form = info.form ?? app.state?.profile?.form;
      if (form) editor.settle(form);
      else editor.close();
      if (setup) {
        watching.stop();
      } else {
        // What moved is news; that it is saved is not (it always is).
        void watching.said().then((text) => {
          if (text !== null) toasts.show(text, 'plain');
        });
        if (editor.changed) soon();
      }
      return true;
    } catch (error) {
      watching.stop();
      const at = refused(error);
      if (at === null) {
        saveNote = () => errorText(error);
      } else {
        // Said at its field; the note says it where the field is not on the page.
        fieldError = {
          field: at.field,
          row: at.row,
          text: () => (at.max !== null ? t.profile.field.atMost(at.max) : t.profile.field.refused),
        };
        if (!(await panel?.revealField(at.field))) saveNote = () => errorText(error);
      }
      return false;
    } finally {
      busy = false;
    }
  }

  /** Saves what changed (a change, Enter in a field); `true` once the profile is saved, or when
   *  there was nothing to save. */
  async function trySave(): Promise<boolean> {
    if (busy) return false;
    if (!editor.changed) return true;
    if (!panel?.valid()) return false;
    return save();
  }

  /** Before the way goes on: what was typed goes into the form (a tag field takes it when it is
   *  left, what it does not take is dropped), the save under way ends and the form is saved;
   *  `false` when a change cannot be saved. */
  async function settled(): Promise<boolean> {
    const field = document.activeElement;
    if (field instanceof HTMLElement && field.matches('input, textarea')) field.blur();
    await tick();
    editor.typed.clear();
    await lastWrite;
    while (editor.changed) {
      if (!panel?.valid() || !(await save())) return false;
    }
    return true;
  }

  /** Esc on an untouched new form: back to the ways in, whose first one takes the focus of the
   *  gone form. */
  function discard(): void {
    saveNote = null;
    fieldError = null;
    editor.discard(stored);
    if (editor.origin === null) void focusFirstWay();
  }

  // ------------------------------------------------------------ what is still missing

  /** A required field's label as the page shows it (the card of what is missing). */
  const labelOf = (field: string): string => {
    const key = LABEL_OF[field as keyof ProfileForm] ?? field;
    return String((t.profile.field as Record<string, unknown>)[key] ?? field);
  };

  const stillMissing = draftMissing();
  /** The required fields still empty, in the order of the page. */
  const missing = $derived(stillMissing());
  /** The setup's Weiter asked for them: from then on they are marked until they are filled
   *  (on the Profil page the card says it, the rows stay calm). */
  let flagged = $state(false);
  $effect(() => {
    if (flagged && missing.length === 0) flagged = false;
  });
  const marked = $derived(setup && flagged ? missing : []);

  /** A field of the form comes into view, no caret (Weiter, Ergänzen). */
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
</script>

{#snippet notes()}
  {#if !setup}<CvProblem />{/if}
  {#if !setup && editor.origin === 'stored' && missing.length > 0}
    <StateBox
      heading={t.profile.missing.heading(missing.length)}
      text={t.profile.missing.fields(missing.map(labelOf))}
      action={{
        label: t.profile.missing.action,
        icon: 'edit',
        testid: 'profile-missing-go',
        onclick: () => void reveal(missing[0]!),
      }}
      testid="profile-missing"
    />
  {/if}
  {#if note}<StateBox heading={note()} alert testid="profile-note" />{/if}
  {#if saveNote}
    <StateBox heading={saveNote()} alert testid="profile-save-error" />
  {/if}
{/snippet}

{#if app.state === null}
  <!-- The shell shows nothing until the state is known. -->
{:else if setup}
  {#if editor.origin !== null}
    <div class="setup" data-testid="profile">
      {@render notes()}
      <ProfileEditor bind:this={panel} {fieldError} missing={marked} />
    </div>
  {/if}
{:else}
  {#snippet head()}
    <ProfileHead
      heading={editor.origin === null && profile?.parseError ? t.profile.unreadable : t.nav.profile}
      form={editor.origin !== null}
      {held}
      oncv={() => void fillFromCv()}
      onfolder={editor.origin === null && profile?.parseError ? openFolder : null}
    />
  {/snippet}
  <Page testid="profile" {over} {head}>
    {#if editor.origin === null}
      <ProfileStart
        broken={profile?.parseError !== null && profile?.parseError !== undefined}
        text={profile?.parseError
          ? `${t.error.text(profile.parseError.kind, profile.parseError.params)} ${t.profile.replaces}`
          : t.profile.noneText}
        note={note?.() ?? null}
        onfilled={(info) => filled(info.form)}
        onempty={create}
      />
    {:else}
      {@render notes()}
      <ProfileEditor
        bind:this={panel}
        {fieldError}
        missing={marked}
        onsave={trySave}
        ondiscard={discard}
        onleft={soon}
      />
    {/if}
  </Page>
{/if}

<!-- A change that cannot be saved: the way goes on without it, or stays. -->
<Dialog
  open={asking}
  variant="danger"
  heading={t.profile.leaveHeading}
  text={held !== null ? t.profile.leaveWrong(held) : t.profile.leaveFailed}
  confirmLabel={t.profile.discard}
  testid="dialog-leave-profile"
  onconfirm={leave}
  oncancel={stay}
/>

<style>
  .setup {
    display: flex;
    flex-direction: column;
    gap: var(--group-section-gap);
  }
</style>
