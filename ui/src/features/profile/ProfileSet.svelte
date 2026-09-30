<!--
  The profiles of the work folder behind the menu of the Profil view's title (core's
  profile::set): a switch (answered by a toast, "Profil gewechselt, Jobs werden neu
  bewertet."; the rescore runs in the background) and Duplizieren (named as a copy, the
  toast names it as the active one), each the active profile from then on, so with unsaved
  changes they ask first (the view's "Änderungen speichern?", `guard`). A new profile is a
  draft of the view: nothing is written before "Speichern". Umbenennen happens in the title
  (the head's field, `renameTo`); emptied, the profile goes by its role or number again.
  "Löschen" asks first naming the profile, then a toast names the profile active now (the one
  active before, core) and offers "Rückgängig" for a moment (the last one leaves the ways in);
  an undo that fails says so. Draws only its dialog; the view calls its functions
  (`bind:this`).
-->
<script lang="ts">
  import Dialog from '$components/Dialog.svelte';
  import { t } from '$lib/i18n/t';
  import { errorText } from '$lib/i18n/texts';
  import { invoke } from '$lib/ipc/api';
  import type { ProfileEntry } from '$lib/ipc/types';
  import { app } from '$lib/state/app.svelte';
  import { editor } from '$lib/state/profile.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import { activeName, defaultName, profileName } from './profiles';

  type Words = () => string;

  interface Props {
    /** A change of the profiles is on its way, or over (the switcher turns meanwhile). */
    onbusy: (on: boolean) => void;
    /** Runs `then` now, or once the form's unsaved changes are saved or discarded. */
    guard: (then: () => void) => void;
    /** Loads the app state, the list and the overview again. */
    reload: () => Promise<boolean>;
    /** A change that failed, said under the head (`null` clears it). */
    onnote: (note: Words | null) => void;
  }

  let { onbusy, guard, reload, onnote }: Props = $props();

  const current = $derived(app.state?.profiles.find((entry) => entry.active) ?? null);

  let confirmRemove = $state(false);
  let removing = $state<ProfileEntry | null>(null);
  let removeBusy = $state(false);

  /** The active profile in the form (after it changed), or the ways in without one. */
  function showActive(): void {
    const form = app.state?.profile?.form ?? null;
    if (form !== null) editor.edit(form);
    else editor.close();
  }

  /** A change of the profiles, then everything loaded again with the active profile in the
   *  form; `true` once made (a cancelled file dialog makes none). */
  async function change(task: () => Promise<unknown>): Promise<boolean> {
    onbusy(true);
    onnote(null);
    try {
      if ((await task()) === null) return false;
      await reload();
      showActive();
      return true;
    } catch (error) {
      onnote(() => errorText(error));
      return false;
    } finally {
      onbusy(false);
    }
  }

  export function switchTo(id: number): void {
    guard(() => {
      void change(() => invoke('switch_profile', { id })).then((done) => {
        if (done) toasts.show(t.profile.switched, 'success');
      });
    });
  }

  export function duplicate(): void {
    guard(() => {
      const source = current;
      if (source === null) return;
      const name = t.profile.copyName(profileName(source));
      void change(() => invoke('duplicate_profile', { id: source.id, name })).then((done) => {
        const now = activeName(app.state?.profiles);
        if (done && now !== null) toasts.show(t.profile.duplicated(now), 'success');
      });
    });
  }

  /** The name typed in the title; the default name left as it stands keeps following the
   *  role. `true` once renamed (a failure is said under the head). */
  export async function renameTo(text: string): Promise<boolean> {
    const entry = current;
    if (entry === null) return false;
    const typed = text.trim();
    const name = entry.name === null && typed === defaultName(entry) ? '' : typed;
    if (name === (entry.name ?? '')) return true;
    onnote(null);
    try {
      await invoke('rename_profile', { id: entry.id, name });
      await app.load();
      return true;
    } catch (error) {
      onnote(() => errorText(error));
      return false;
    }
  }

  export function askRemove(): void {
    removing = current;
    confirmRemove = removing !== null;
  }

  async function remove(): Promise<void> {
    const entry = removing;
    if (entry === null) return;
    removeBusy = true;
    onnote(null);
    try {
      const removed = await invoke('delete_profile', { id: entry.id });
      confirmRemove = false;
      await reload();
      showActive();
      if (removed) {
        const now = activeName(app.state?.profiles);
        toasts.show(now === null ? t.profile.removed : t.profile.removedNow(now), 'success', {
          label: t.common.undo,
          onclick: () => guard(() => void restore(entry.id)),
        });
      }
    } catch (error) {
      confirmRemove = false;
      onnote(() => errorText(error));
    } finally {
      removeBusy = false;
    }
  }

  /**
   * "Rückgängig" of a deletion (the profile comes back as the active one) or, without a
   * number, of a file that replaced the profile (the backup becomes the profile again); the
   * form shows it, unless it holds changes.
   */
  export async function restore(id: number | null): Promise<void> {
    onnote(null);
    let back: boolean;
    try {
      back = await invoke('restore_profile', { id });
    } catch {
      back = false;
    }
    if (!back) {
      toasts.show(t.profile.restoreFailed, 'info');
      return;
    }
    await reload();
    if (!editor.dirty) showActive();
  }
</script>

<!-- The heading says it all: the dialog does not repeat it. -->
<Dialog
  bind:open={confirmRemove}
  variant="danger"
  heading={t.profile.removeHeading(removing === null ? '' : profileName(removing))}
  confirmLabel={t.profile.removeConfirm}
  busy={removeBusy}
  testid="dialog-remove-profile"
  onconfirm={() => void remove()}
/>
