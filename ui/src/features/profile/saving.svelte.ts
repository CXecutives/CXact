// How the Profil saves. A change saves by itself, like a setting (owner, 2026-10-30): a moment
// after a control changed, a text field once it is left or with Enter, and before the view is
// left or the window closes. Nothing asks and nothing bars the way, and nothing is said unless
// the rescore of the save moved jobs (a toast, saveEffect.ts). What changes while a save is
// under way goes next; a save that failed says so under the head and is tried again with the
// next change or the next way out. A value that is wrong holds the save, said at its field;
// leaving with one, or with a save that failed, asks once whether to drop it, and nothing is
// saved behind the question. ProfileView holds the page, this the save and the way out.

import { t } from '$lib/i18n/t';
import { errorText } from '$lib/i18n/texts';
import { invoke } from '$lib/ipc/api';
import type { ProfileForm } from '$lib/ipc/types';
import { app } from '$lib/state/app.svelte';
import { jobs } from '$lib/state/jobs.svelte';
import { navigation, type ViewId } from '$lib/state/navigation.svelte';
import { editor } from '$lib/state/profile.svelte';
import { toasts } from '$lib/state/toasts.svelte';
import { tokenMs } from '$lib/tokens';
import { tick, untrack } from 'svelte';
import type ProfileEditor from './ProfileEditor.svelte';
import type { FieldError } from './ProfileEditor.svelte';
import { refused, watchSave, type SaveEffect } from './saveEffect';

/** A failure is said when it shows. */
export type Words = () => string;

/** What the page tells the save. */
interface ThePage {
  /** The form on the page. */
  panel: () => ProfileEditor | null;
  /** The setup's page: only its Weiter saves, and nothing is said. */
  setup: () => boolean;
  /** The stored form, what a dropped change goes back to. */
  stored: () => ProfileForm | null;
  /** The window could not be closed. */
  onfailed: (words: Words) => void;
}

const valueText = (form: ProfileForm, field: string): string =>
  JSON.stringify((form as Record<string, unknown>)[field] ?? null);

/** The state again after a change; `false` when it could not be loaded. */
async function reload(): Promise<boolean> {
  const loaded = await app.load();
  void jobs.load(true);
  void jobs.loadOverview();
  return loaded !== null;
}

export class ProfileSaving {
  readonly #page: ThePage;
  /** A save is under way. */
  busy = $state(false);
  /** Why a save did not go, said under the head. */
  note = $state<Words | null>(null);
  /** A value the backend refused on the last save, said at its field. */
  fieldError = $state<FieldError | null>(null);
  /** The refused field's value then, as text. */
  #refusedValue: string | null = null;
  /** Where the way out leads while the form is saved or the question stands: a view, or closing
   *  the window (a second way only changes where it leads). */
  leaving: ViewId | 'close' | null = null;
  /** A change cannot be saved: the question whether to drop it stands. */
  asking = $state(false);
  /** The window (main.rs) and a way out wait while the form holds unsaved changes; a save under
   *  way counts, as what was taken back meanwhile goes after it. */
  readonly dirty = $derived(editor.dirty || this.busy);

  #timer: ReturnType<typeof setTimeout> | undefined;
  /** The toast of the last save, until the next one takes over. */
  #lastSave: SaveEffect | null = null;
  /** The last save, done or still under way, and whether it saved. */
  #lastWrite: Promise<boolean> = Promise.resolve(true);

  constructor(page: ThePage) {
    this.#page = page;
    // A refused value stays with its error until that value changes.
    $effect(() => {
      const error = this.fieldError;
      if (error === null) return;
      const now = valueText(editor.after, error.field);
      untrack(() => {
        if (this.#refusedValue === null) this.#refusedValue = now;
        else if (now !== this.#refusedValue) this.fieldError = null;
      });
    });
    $effect(() => {
      const on = this.dirty;
      untrack(() => void invoke('set_unsaved', { on }).catch(() => undefined));
    });
    $effect(() => {
      if (!page.setup() && editor.changed) untrack(() => this.soon());
    });
  }

  #closeWindow(): void {
    invoke('close_window').catch((error: unknown) => this.#page.onfailed(() => errorText(error)));
  }

  /** The way goes on to where it leads. */
  #goOn(): void {
    const next = this.leaving;
    this.leaving = null;
    this.asking = false;
    if (next === 'close') this.#closeWindow();
    else if (next !== null) navigation.go(next, true);
  }

  /** Leaves once what the form holds is saved; a change that cannot be saved asks first. */
  async leaveTo(next: ViewId | 'close'): Promise<void> {
    const going = this.leaving !== null;
    this.leaving = next;
    if (going) return;
    clearTimeout(this.#timer);
    if (await this.settled()) this.#goOn();
    else this.asking = true;
  }

  /** The window is to close: the page says it is here, then saves. */
  async closeRequested(): Promise<void> {
    await invoke('set_unsaved', { on: this.dirty }).catch(() => undefined);
    await this.leaveTo('close');
  }

  /** The change that cannot be saved goes, and the way goes on. */
  leave(): void {
    this.note = null;
    this.fieldError = null;
    editor.discard(this.#page.stored());
    this.#goOn();
  }

  /** Staying: what waited for the way goes with it; what holds the save is said at its field,
   *  which comes into view. */
  stay(): void {
    this.leaving = null;
    this.asking = false;
    navigation.stay();
    this.#page.panel()?.ready();
  }

  /** A moment after a change, and when a field was left; not on a way out, which saves first
   *  and then stands at its question. */
  soon(): void {
    clearTimeout(this.#timer);
    if (this.leaving !== null) return;
    this.#timer = setTimeout(() => {
      if (!this.#page.panel()?.typing()) void this.trySave();
    }, tokenMs('--save-delay'));
  }

  /** The timer of `soon` is off (the view goes). */
  stop(): void {
    clearTimeout(this.#timer);
  }

  /** `true` when the profile is saved. */
  save(): Promise<boolean> {
    this.#lastWrite = this.#write();
    return this.#lastWrite;
  }

  /** One save: the form goes, the state comes back and the form settles on it. */
  async #write(): Promise<boolean> {
    this.busy = true;
    this.note = null;
    this.fieldError = null;
    this.#refusedValue = null;
    this.#lastSave?.stop();
    const watching = watchSave();
    this.#lastSave = watching;
    try {
      const info = await editor.save();
      // The saved profile is the answer of the save: a state that could not be loaded
      // again never puts the old values back.
      if (!(await reload()) && app.state) app.state.profile = info;
      const form = info.form ?? app.state?.profile?.form;
      if (form) editor.settle(form);
      else editor.close();
      if (this.#page.setup()) {
        watching.stop();
      } else {
        // What moved is news; that it is saved is not (it always is).
        void watching.said().then((text) => {
          if (text !== null) toasts.show(text, 'plain');
        });
        if (editor.changed) this.soon();
      }
      return true;
    } catch (error) {
      watching.stop();
      const at = refused(error);
      if (at === null) {
        this.note = () => errorText(error);
      } else {
        // Said at its field; the note says it where the field is not on the page.
        this.fieldError = {
          field: at.field,
          row: at.row,
          text: () => (at.max !== null ? t.profile.field.atMost(at.max) : t.profile.field.refused),
        };
        if (!(await this.#page.panel()?.revealField(at.field))) {
          this.note = () => errorText(error);
        }
      }
      return false;
    } finally {
      this.busy = false;
    }
  }

  /** Saves what changed (a change, Enter in a field); `true` once the profile is saved, or when
   *  there was nothing to save. */
  async trySave(): Promise<boolean> {
    if (this.busy) return false;
    if (!editor.changed) return true;
    if (!this.#page.panel()?.valid()) return false;
    return this.save();
  }

  /** Before the way goes on: what was typed goes into the form (a tag field takes it when it is
   *  left, what it does not take is dropped), the save under way ends and the form is saved;
   *  `false` when a change cannot be saved. */
  async settled(): Promise<boolean> {
    const field = document.activeElement;
    if (field instanceof HTMLElement && field.matches('input, textarea')) field.blur();
    await tick();
    editor.typed.clear();
    await this.#lastWrite;
    while (editor.changed) {
      if (!this.#page.panel()?.valid() || !(await this.save())) return false;
    }
    return true;
  }

  /** The form goes back to what is stored, with what was said about it. */
  discard(): void {
    this.note = null;
    this.fieldError = null;
    editor.discard(this.#page.stored());
  }
}
