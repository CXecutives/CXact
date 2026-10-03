<!--
  Profil (centred 720): the one profile of the app as a form on one page. Without a profile
  the start page with the two ways in (ProfileStart: "Aus Lebenslauf ausfüllen", "Selbst
  ausfüllen"); a file that no longer reads says so in the same place, with its folder at hand.
  With a profile its head ("Profil", "Aus Lebenslauf ausfüllen", the lines of what is still
  open), the jump links to the three sections (they stay in view while the page scrolls,
  unless the window is low) and the form, whose save bar shows while it holds a change. A save
  is answered by a toast once the bar has gone, with what its rescore changed (saveEffect.ts).
  Leaving the view or closing the window with unsaved changes asks once ("Änderungen
  speichern?", the heading alone). During setup the toast of the first save offers "Weiter
  zum ersten Abruf", which starts the fetch, or without a mailbox "Weiter zum Postfach", which
  goes back to the setup page.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import Dialog from '$components/Dialog.svelte';
  import { t } from '$lib/i18n/t';
  import { errorText } from '$lib/i18n/texts';
  import { IpcError, invoke, onCloseRequested } from '$lib/ipc/api';
  import type { ProfileForm } from '$lib/ipc/types';
  import { crossfadeDuration, duration } from '$lib/motion/motion';
  import { app } from '$lib/state/app.svelte';
  import { jobs } from '$lib/state/jobs.svelte';
  import { navigation, type ViewId } from '$lib/state/navigation.svelte';
  import { editor, sameForm } from '$lib/state/profile.svelte';
  import { run } from '$lib/state/run.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import { onMount, tick, untrack } from 'svelte';
  import { fromCv } from '../shared/fromCv.svelte';
  import ProfileEditor, { type FieldError } from './ProfileEditor.svelte';
  import ProfileHeader from './ProfileHeader.svelte';
  import ProfileStart from './ProfileStart.svelte';
  import { watchSave } from './saveEffect';
  import { FIELD_ORDER, SECTIONS, blank } from './sections';

  const profile = $derived(app.state?.profile ?? null);
  const stored = $derived(profile?.form ?? null);
  const rescoring = $derived((run.active && run.kind === 'rescore') || (profile?.pending ?? 0) > 0);

  let busy = $state<'save' | null>(null);
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

  /** The toast that answers a save waits until the save bar has gone (the stack then stands
   *  at the bottom), at most as long as the bar takes. */
  let afterBar: (() => void) | null = null;
  function whenBarGone(show: () => void): void {
    afterBar = show;
    setTimeout(barGone, duration('slow') + crossfadeDuration());
  }
  function barGone(): void {
    const show = afterBar;
    afterBar = null;
    show?.();
  }

  /** The toast of a save; during setup it leads on: to the first fetch with a mailbox, else
   *  back to the setup page, whose next step is the mailbox. */
  function savedToast(text: string): void {
    const next =
      app.state?.firstRun && app.hasProfile
        ? {
            label: app.hasMailbox ? t.profile.next : t.profile.nextMailbox,
            onclick: () => void onward(),
          }
        : null;
    toasts.show(text, 'success', next);
  }

  /** The setup page, or the Jobs view that shows the first fetch, which starts at once when
   *  nothing holds it (a start that fails is said in the last step of the setup page). */
  async function onward(): Promise<void> {
    navigation.go('jobs');
    if (app.hasMailbox && run.fetchBlocked === null) await run.start({ kind: 'fetch' });
  }
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
    const release = navigation.guard((next) => {
      if (!editor.dirty) return true;
      leaving = next;
      return false;
    });
    const stopClose = onCloseRequested(() => void closeRequested());
    return () => {
      release();
      stopClose();
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

  async function fillFromCv(): Promise<void> {
    const info = await fromCv.run();
    if (info !== null) filled(info.form);
  }

  /** The caret into a field that has just appeared (the input of a chip field). */
  async function caretTo(testid: string): Promise<void> {
    await tick();
    const node = document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
    const target = node?.matches('input, textarea, button') ? node : node?.querySelector('input');
    target?.focus();
  }

  let panel = $state<{
    ready: () => boolean;
    focusField: (field: string) => Promise<boolean>;
  } | null>(null);

  /** A value out of range: the field (and row) it names, and the limit where one is. */
  function refused(
    error: unknown,
  ): { field: string; row: number | null; max: number | null } | null {
    if (!(error instanceof IpcError) || error.params.reason !== 'profileValue') return null;
    const { field, row, max } = error.params;
    return typeof field === 'string'
      ? {
          field,
          row: typeof row === 'number' ? row : null,
          max: typeof max === 'number' ? max : null,
        }
      : null;
  }

  /** `true` when the profile is saved. */
  async function save(): Promise<boolean> {
    busy = 'save';
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
      whenBarGone(() => void effect.said().then(savedToast));
      return true;
    } catch (error) {
      effect.stop();
      const at = refused(error);
      if (at === null) {
        saveNote = () => errorText(error);
      } else {
        // Said at its field without its name again; the save bar says it where the field
        // is not on the page.
        fieldError = {
          field: at.field,
          row: at.row,
          text: () => (at.max !== null ? t.profile.field.atMost(at.max) : t.profile.field.refused),
        };
        if (!(await panel?.focusField(at.field))) saveNote = () => errorText(error);
      }
      return false;
    } finally {
      busy = null;
    }
  }

  /** Back to the stored profile, or (a new form) to the ways in, whose first one takes the
   *  focus of the gone form. */
  function discard(): void {
    saveNote = null;
    fieldError = null;
    editor.discard(stored);
    if (editor.origin === null) void caretTo('new-profile-cv');
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

  // ------------------------------------------------------------ what is still open

  /** The required fields still empty, in the order of the page: core names them for the
   *  stored profile (`missing`), the form drops those filled since. */
  const missing = $derived(
    FIELD_ORDER.filter(
      (field) => (profile?.missing ?? []).includes(field) && blank(editor.after, field),
    ),
  );
  /** The fields the CV filled, while the form shows the stored profile. */
  const aiFilled = $derived(editor.origin === 'stored' ? (profile?.aiFilled ?? []) : []);

  /** A jump link: its section's heading at the top, under the links, with the focus. */
  function jump(id: string): void {
    const heading = document.getElementById(`profile-section-${id}-heading`);
    document.getElementById(`profile-section-${id}`)?.scrollIntoView({ block: 'start' });
    heading?.focus({ preventScroll: true });
  }
</script>

<div class="page" data-testid="profile">
  {#if app.state === null}
    <!-- The shell shows nothing until the state is known. -->
  {:else if editor.origin === null}
    <ProfileStart
      heading={profile?.parseError ? t.profile.unreadable : t.profile.title}
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
    <ProfileHeader
      open={missing.length}
      filled={aiFilled.length > 0}
      {rescoring}
      pending={profile?.pending ?? 0}
      dirty={editor.dirty}
      note={note?.() ?? null}
      onfirst={() => void panel?.focusField(missing[0] ?? '')}
      oncv={() => void fillFromCv()}
    />
    <nav class="jumps" aria-label={t.profile.sections} data-testid="profile-jumps">
      {#each SECTIONS as section (section.id)}
        <Button
          variant="ghost"
          label={t.profile.section[section.id]}
          testid="profile-jump-{section.id}"
          onclick={() => jump(section.id)}
        />
      {/each}
    </nav>
    <ProfileEditor
      bind:this={panel}
      {fieldError}
      {aiFilled}
      busy={busy === 'save'}
      note={saveNote?.() ?? null}
      onsave={() => void save()}
      ondiscard={discard}
      onbargone={barGone}
    />
  {/if}
</div>

<!-- The heading says it all: the dialog does not repeat it. -->
<Dialog
  open={leaving !== null}
  heading={t.profile.leaveHeading}
  confirmLabel={t.profile.save}
  altLabel={t.profile.discard}
  busy={busy === 'save'}
  testid="dialog-leave-profile"
  onconfirm={() => void saveAndLeave()}
  onalt={leave}
  oncancel={() => (leaving = null)}
/>

<style>
  /* The same 32 between the head and the first section as between all sections. */
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--space-32);
    max-width: calc(var(--reader-width) + 2 * var(--pane-padding));
    min-height: 100%;
    margin: 0 auto;
    padding: var(--pane-padding) var(--pane-padding) var(--page-end);
  }

  /* While the save bar is there (its way out too), it ends the page at the bottom edge;
     otherwise the room under the last section stays (--page-end). */
  .page:has(> :global([data-save-bar])) {
    padding-bottom: 0;
  }

  /* The jump links stay at the top of the view while the page scrolls; in a low window
     they scroll away with the head. The ghost buttons' words start on the column's edge. */
  .jumps {
    position: sticky;
    z-index: var(--z-sticky);
    top: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    margin: calc(-1 * var(--space-16)) 0 calc(-1 * var(--space-16)) calc(-1 * var(--ghost-inset));
    padding: var(--space-8) 0;
    background-color: var(--surface);
  }

  @media (height < 560px) {
    .jumps {
      position: static;
    }
  }
</style>
