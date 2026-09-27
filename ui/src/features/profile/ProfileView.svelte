<!--
  Profil (centred 720): the profile itself as a form. Without a profile an empty state with
  the three ways in (from a CV with an AI, the recommended one; a new form; an existing
  file); a file that no longer reads says so in the same place, with its folder at hand.
  With a profile its head
  (a status when there is one, the file actions) and the form, whose save bar shows while it
  holds a change. A chosen file and an AI's answer fill the form for review (an answer for
  the stored profile updates it); nothing is stored before "Speichern". A save is answered by
  a toast once the bar has gone, with what its rescore changed (saveEffect.ts). Leaving the
  view or closing the window with unsaved changes asks once ("Änderungen speichern?").
  "Profil löschen" asks first, then a toast offers "Rückgängig" for a moment; so does saving
  another file over the profile (the backup comes back, core's swap), and an undo that fails
  says so. During setup the toast of the first save offers "Weiter zum ersten Abruf", which
  starts the fetch, or without a mailbox "Weiter zum Postfach", which goes back to the setup
  page; the setup page asks for the steps with an AI (`cvWanted`), which open when the view
  appears.
-->
<script lang="ts">
  import Dialog from '$components/Dialog.svelte';
  import { t } from '$lib/i18n/t';
  import { errorText, warningText } from '$lib/i18n/texts';
  import { IpcError, invoke, onCloseRequested } from '$lib/ipc/api';
  import type { Notice } from '$lib/ipc/types';
  import { crossfadeDuration, duration } from '$lib/motion/motion';
  import { app } from '$lib/state/app.svelte';
  import { jobs } from '$lib/state/jobs.svelte';
  import { navigation, type ViewId } from '$lib/state/navigation.svelte';
  import {
    editor,
    fieldProblems,
    localQuality,
    sameForm,
    type FieldError,
  } from '$lib/state/profile.svelte';
  import { run } from '$lib/state/run.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import { onMount, tick, untrack } from 'svelte';
  import ProfileEditor from './ProfileEditor.svelte';
  import ProfileHeader from './ProfileHeader.svelte';
  import ProfilePaste from './ProfilePaste.svelte';
  import ProfileStart from './ProfileStart.svelte';
  import { watchSave } from './saveEffect';
  import { valueText } from './sections';

  const profile = $derived(app.state?.profile ?? null);
  const stored = $derived(profile?.form ?? null);
  const rescoring = $derived((run.active && run.kind === 'rescore') || (profile?.pending ?? 0) > 0);

  /** The prompts for a new profile and for an update of the stored one, loaded ahead so that
   *  copying needs no wait. */
  let prompts = $state<{ create: string | null; update: string | null }>({
    create: null,
    update: null,
  });
  let copied = $state(false);
  let busy = $state<'pick' | 'save' | 'remove' | 'paste' | null>(null);
  /** "Profil löschen" asks first. */
  let confirmRemove = $state(false);
  /** A failure is said when it shows, so it follows a switch of the language. */
  type Words = () => string;
  let note = $state<Words | null>(null);
  let saveNote = $state<Words | null>(null);
  let pasteError = $state<Words | null>(null);
  /** The steps with an AI update the stored profile (else they make a new one). */
  let updating = $state(false);
  const prompt = $derived(updating ? prompts.update : prompts.create);
  /** A value the backend refused on the last save, said at its field. */
  let fieldError = $state<FieldError | null>(null);
  /** The refused field's value then, as text. */
  let refusedValue: string | null = null;
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
  /** Where the user wanted to go with unsaved changes (a view, or closing the window). */
  let leaving = $state<ViewId | 'close' | null>(null);

  // The stored profile fills the form while nothing unsaved is in it (also after a save).
  $effect(() => {
    const form = stored;
    untrack(() => {
      if (editor.dirty || editor.origin === 'new' || editor.pasting) return;
      if (form === null) {
        if (editor.origin === 'stored') editor.close();
      } else if (editor.origin !== 'stored' || !sameForm(editor.before, form)) {
        editor.edit(form);
      }
    });
  });

  // The update prompt carries the stored profile: it is loaded again whenever that changes.
  $effect(() => {
    const form = stored;
    untrack(() => {
      prompts.update = null;
      if (form === null) return;
      invoke('profile_prompt', { update: true })
        .then((text) => {
          if (stored === form) prompts.update = text;
        })
        .catch(() => undefined);
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
    invoke('profile_prompt', { update: false })
      .then((text) => (prompts.create = text))
      .catch(() => undefined);
    const release = navigation.guard((next) => {
      if (!editor.dirty) return true;
      leaving = next;
      return false;
    });
    // The setup page asked for the steps with an AI.
    if (editor.cvWanted) {
      editor.cvWanted = false;
      void fromCv();
    }
    const stopClose = onCloseRequested(() => void closeRequested());
    return () => {
      release();
      stopClose();
      void invoke('set_unsaved', { on: false }).catch(() => undefined);
      // An untouched new form or the steps with an AI start over next time.
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

  async function pick(): Promise<void> {
    busy = 'pick';
    note = null;
    try {
      const draft = await invoke('pick_profile');
      if (draft !== null) editor.take(draft, 'file');
    } catch (error) {
      note = () => errorText(error);
    } finally {
      busy = null;
    }
  }

  function openFolder(): void {
    note = null;
    invoke('open_target', { target: { kind: 'profileDir' } }).catch(
      (error: unknown) => (note = () => errorText(error)),
    );
  }

  async function copyPrompt(): Promise<void> {
    const kind = updating ? 'update' : 'create';
    try {
      const text = prompts[kind] ?? (await invoke('profile_prompt', { update: updating }));
      prompts[kind] = text;
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      copied = false;
    }
  }

  /** The prompt goes to the clipboard first, so the steps show whether it got there; with an
   *  answer pasted earlier the clipboard is left alone ("Erneut kopieren" copies). For the
   *  stored profile it is the update prompt, and the answer updates the profile. */
  async function fromCv(): Promise<void> {
    pasteError = null;
    updating = editor.origin === 'stored' && stored !== null;
    if (editor.answer.trim() === '') await copyPrompt();
    else copied = true;
    editor.pasting = true;
    // The prompt is on the clipboard: the next step is pasting the answer.
    await caretTo('paste-answer');
  }

  /** A new form: the caret goes into its first field. */
  async function create(): Promise<void> {
    editor.create();
    await caretTo('profile-name-field');
  }

  /** The caret into a field that has just appeared. */
  async function caretTo(testid: string): Promise<void> {
    await tick();
    document.querySelector<HTMLElement>(`[data-testid="${testid}"]`)?.focus();
  }

  async function takeAnswer(answer: string): Promise<void> {
    busy = 'paste';
    pasteError = null;
    try {
      const draft = await invoke('parse_profile', { text: answer, update: updating });
      if (updating && stored !== null) editor.update(draft, stored);
      else editor.take(draft, 'answer');
      editor.answer = '';
    } catch (error) {
      pasteError = () => errorText(error);
    } finally {
      busy = null;
    }
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

  /** `true` when the profile is saved. Another file saved over the profile replaces it: a
   *  toast offers the old one back. */
  async function save(): Promise<boolean> {
    busy = 'save';
    saveNote = null;
    fieldError = null;
    refusedValue = null;
    const replaced = replacing;
    const effect = watchSave();
    try {
      const info = await editor.save();
      // The saved profile is the answer of the save: a state that could not be loaded
      // again never puts the old values back.
      if (!(await reload()) && app.state) app.state.profile = info;
      const form = info.form ?? app.state?.profile?.form;
      if (form) editor.edit(form);
      else editor.close();
      whenBarGone(() => {
        if (!replaced) return void effect.said().then(savedToast);
        effect.stop();
        toasts.show(t.profile.replaced, 'success', {
          label: t.common.undo,
          onclick: () => void restore(),
        });
      });
      return true;
    } catch (error) {
      effect.stop();
      const at = refused(error);
      if (at === null) {
        saveNote = () => errorText(error);
      } else {
        // Said at its field without its name again; the save bar says it where the field
        // is not on the page. The second day of the workload below the first has no limit.
        fieldError = {
          field: at.field,
          row: at.row,
          text: () =>
            at.max !== null
              ? t.profile.field.atMost(at.max)
              : at.field === 'workloadMaxDays'
                ? t.profile.field.workloadOrder
                : t.profile.field.refused,
        };
        if (!(await panel?.focusField(at.field))) saveNote = () => errorText(error);
      }
      return false;
    } finally {
      busy = null;
    }
  }

  /** Back to the stored profile, or (a new form, a draft) to the ways in, whose first one
   *  takes the focus of the gone form. */
  function discard(): void {
    saveNote = null;
    fieldError = null;
    editor.discard(stored);
    if (editor.origin === null) void caretTo('profile-create');
  }

  async function remove(): Promise<void> {
    busy = 'remove';
    note = null;
    try {
      const removed = await invoke('remove_profile');
      confirmRemove = false;
      editor.close();
      await reload();
      if (removed) {
        toasts.show(t.profile.removed, 'success', {
          label: t.common.undo,
          onclick: () => void restore(),
        });
      }
    } catch (error) {
      confirmRemove = false;
      note = () => errorText(error);
    } finally {
      busy = null;
    }
  }

  /** "Rückgängig" of a removal or of a file that replaced the profile: the backup becomes
   *  the profile again (the form shows it, unless it holds changes). */
  async function restore(): Promise<void> {
    note = null;
    let back: boolean;
    try {
      back = await invoke('restore_profile');
    } catch {
      back = false;
    }
    if (back) await reload();
    else toasts.show(t.profile.restoreFailed, 'info');
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

  // ------------------------------------------------------------ what the form says

  /** What the engine reads: a draft's own, else the stored profile's (an update from a CV is
   *  saved into it); a new form has none yet. */
  const understood = $derived(
    editor.origin === 'file' || editor.origin === 'answer'
      ? editor.understood
      : editor.origin === 'new'
        ? null
        : (profile?.understood ?? null),
  );
  const warnings = $derived<readonly Notice[]>(understood?.warnings ?? []);
  const problems = $derived(
    editor.origin === null
      ? []
      : fieldProblems(warnings, editor.before, editor.after, editor.cleared),
  );
  /** The quality of the form as it is: the engine's for what it read, followed while the
   *  form changes; a new form says nothing before it has something. */
  const local = $derived(
    editor.origin === null
      ? null
      : localQuality(understood?.competenceCount ?? 0, editor.before, editor.after),
  );
  const quality = $derived.by(() => {
    if (local === null) return null;
    // Unchanged, the engine's own word counts.
    const unchanged = sameForm(editor.before, editor.after);
    if (editor.origin === 'new' && unchanged) return null;
    if (editor.origin === 'stored' && unchanged) return profile?.quality ?? local.quality;
    if ((editor.origin === 'file' || editor.origin === 'answer') && unchanged) {
      return editor.quality ?? local.quality;
    }
    return local.quality;
  });
  /** What "n Werte prüfen" counts: each value of the file that does not read, by the field
   *  it is said at. */
  const checkList = $derived(
    problems.flatMap((problem) =>
      problem.entry || warningText(problem.notice) !== null ? [problem.field as string] : [],
    ),
  );

  /** "n Werte prüfen": the caret to the first of them, in the order of the form. */
  function checkFirst(): void {
    const fields = new Set(checkList);
    const first = [...document.querySelectorAll<HTMLElement>('[data-field]')].find((node) =>
      fields.has(node.dataset.field ?? ''),
    );
    const field = first?.dataset.field ?? checkList[0];
    if (field !== undefined) void panel?.focusField(field);
  }
  /** Said in the head: what the form cannot change (keys of the file the app does not read). */
  const HEAD = new Set(['ignoredKeys']);
  /** Said elsewhere or not at all: the quality (the sections say "Noch leer"), empty
   *  criteria at their section, a value at its field, a region rule at the remote share, the
   *  Schwerpunkte taken over at the Schwerpunkte. */
  const ELSEWHERE = new Set([
    'fewCompetences',
    'noCompetences',
    'noCriteria',
    'criterionNotUnderstood',
    'availabilityNotUnderstood',
    'regionWithoutPlaces',
    'focusTrimmed',
  ]);
  const headWarnings = $derived(warnings.filter((w) => HEAD.has(w.code) || !ELSEWHERE.has(w.code)));
  /** Another file over the stored profile: saving replaces it. */
  const replacing = $derived(editor.origin === 'file' && profile !== null);
</script>

<div class="page" class:editing={editor.origin !== null && !editor.pasting} data-testid="profile">
  {#if app.state === null}
    <!-- The shell shows nothing until the state is known. -->
  {:else if editor.pasting}
    <ProfilePaste
      heading={updating ? t.profile.updateFromCv : t.profile.fromCv}
      {prompt}
      {copied}
      busy={busy === 'paste'}
      error={pasteError?.() ?? null}
      bind:answer={editor.answer}
      oncopy={() => void copyPrompt()}
      ontake={(answer) => void takeAnswer(answer)}
      oncancel={() => (editor.pasting = false)}
    />
  {:else if editor.origin === null}
    <div class="empty">
      <ProfileStart
        heading={profile?.parseError ? t.profile.unreadable : t.profile.none}
        text={profile?.parseError
          ? `${t.error.text(profile.parseError.kind, profile.parseError.params)} ${t.profile.replaces}`
          : t.profile.noneText}
        picking={busy === 'pick'}
        unreadable={profile?.parseError !== null && profile?.parseError !== undefined}
        note={note?.() ?? null}
        oncreate={() => void create()}
        onfromcv={() => void fromCv()}
        onpick={() => void pick()}
        onopenfolder={openFolder}
      />
    </div>
  {:else}
    <ProfileHeader
      origin={editor.origin}
      {profile}
      checks={checkList.length}
      warnings={headWarnings}
      {rescoring}
      dirty={editor.dirty}
      {replacing}
      picking={busy === 'pick'}
      note={note?.() ?? null}
      onpick={() => void pick()}
      onremove={() => (confirmRemove = true)}
      onfromcv={() => void fromCv()}
      onopenfolder={openFolder}
      oncheck={checkFirst}
    />
    <ProfileEditor
      bind:this={panel}
      {quality}
      {problems}
      {warnings}
      {fieldError}
      busy={busy === 'save'}
      note={saveNote?.() ?? null}
      onsave={() => void save()}
      ondiscard={discard}
      onbargone={barGone}
    />
  {/if}
</div>

<!-- The headings say it all: the dialogs do not repeat them. -->
<Dialog
  bind:open={confirmRemove}
  variant="danger"
  heading={t.profile.removeHeading}
  confirmLabel={t.profile.removeConfirm}
  busy={busy === 'remove'}
  testid="dialog-remove-profile"
  onconfirm={() => void remove()}
/>
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
    padding: var(--pane-padding) var(--pane-padding) var(--space-48);
  }

  /* The save bar ends the page at the bottom edge. */
  .editing {
    padding-bottom: 0;
  }

  /* The empty state sits at about 38 % of the height (spacers 38 : 62), not dead centre. */
  .empty {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
  }

  .empty::before,
  .empty::after {
    content: '';
  }

  .empty::before {
    flex: 38;
  }

  .empty::after {
    flex: 62;
  }
</style>
