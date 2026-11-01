// The profile editor (Profil view): the one profile of the app, the form as it was handed out
// (`before`), the form as the user has it (`after`) and where it came from. Saving sends both;
// the backend writes only what differs. ProfileView saves a change by itself and before the
// view is left or the window closes (it holds the guard, and the dialog for a change that
// cannot be saved); the setup saves with its Weiter.
//
// The limits and the form of a new profile come from core (`types/profile.ts`, written from
// `core/src/profile/form.rs`); which fields a usable profile still needs too
// (`ProfileInfo.missing`, core `missing_required`).

import { invoke } from '../ipc/api';
import { app } from './app.svelte';
import type { ProfileForm, ProfileInfo } from '../ipc/types';
import { EMPTY_FORM } from '../ipc/types/profile';
import { putTerm, takeTerm, type ProfileTerm } from './terms';
import { TypedText } from './typed.svelte';

export type Competence = ProfileForm['competences'][number];
export type Language = ProfileForm['languages'][number];
export type LanguageLevel = Language['level'];

/** Where the form in the editor came from: the stored profile or a new one. */
export type DraftOrigin = 'stored' | 'new';

/** The form of a new profile (`ProfileForm::default()`). */
export function emptyForm(): ProfileForm {
  return structuredClone(EMPTY_FORM);
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** Trimmed, without empty entries, each entry once (case-insensitive). */
export function cleanList(items: readonly string[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    const text = item.trim();
    if (text !== '' && !out.some((o) => same(o, text))) out.push(text);
  }
  return out;
}

const positive = (value: number | null): number | null =>
  value !== null && value > 0 ? value : null;

/** Rows trimmed by their name, without empty ones, each name once. */
function cleanRows<Row>(rows: readonly Row[], name: (row: Row) => string): Row[] {
  const out: Row[] = [];
  for (const row of rows) {
    const text = name(row).trim();
    if (text !== '' && !out.some((o) => same(name(o).trim(), text))) out.push(row);
  }
  return out;
}

/** The form the way the backend compares it: trimmed, empty rows and entries gone, numbers
 *  of zero as none, the minimum salary only with Festanstellung or Zeitarbeit. */
export function normalized(form: ProfileForm): ProfileForm {
  return {
    ...form,
    roles: cleanList(form.roles),
    dayRateWish: positive(form.dayRateWish),
    dayRateMin: positive(form.dayRateMin),
    minSalary: form.permanent || form.temporary ? positive(form.minSalary) : null,
    countries: cleanList(form.countries.map((code) => code.toUpperCase())),
    regions: cleanList(form.regions),
    available:
      form.available.kind === 'from'
        ? { kind: 'from', date: form.available.date.trim() }
        : { kind: 'now' },
    competences: cleanRows(form.competences, (row) => row.name).map((row) => ({
      ...row,
      name: row.name.trim(),
    })),
    tools: cleanList(form.tools),
    industries: cleanList(form.industries),
    languages: cleanRows(form.languages, (row) => row.language).map((row) => ({
      ...row,
      language: row.language.trim(),
    })),
    degrees: cleanList(form.degrees),
    certificates: cleanList(form.certificates),
    exclusionWords: cleanList(form.exclusionWords),
  };
}

export function sameForm(a: ProfileForm, b: ProfileForm): boolean {
  return JSON.stringify(normalized(a)) === JSON.stringify(normalized(b));
}

const copy = (form: ProfileForm): ProfileForm => structuredClone($state.snapshot(form));

/** A list with the row at `at` (counted among the rows with a name, as core does) as it was
 *  handed out, or without it when it was not. */
function rowBack<Row>(
  rows: Row[],
  handed: readonly Row[],
  at: number,
  name: (row: Row) => string,
): Row[] {
  const row = rows.filter((each) => name(each).trim() !== '')[at];
  if (row === undefined) return rows;
  const was = handed.find((each) => same(name(each).trim(), name(row).trim()));
  return was === undefined
    ? rows.filter((each) => each !== row)
    : rows.map((each) => (each === row ? structuredClone(was) : each));
}

/** A save of the form: what was handed out and what the user made of it (core rebases the
 *  lists on what is stored meanwhile). Without a stored profile it is the first one. */
function send(before: ProfileForm, after: ProfileForm): Promise<ProfileInfo> {
  return invoke('save_profile', { save: { before, after } });
}

// ------------------------------------------------------------------ dates

const pad = (value: number): string => String(value).padStart(2, '0');

/** `2026-11-01` -> `01.11.2026` (as the form keeps a day). */
export function shownDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match === null) return iso;
  const [, year, month, day] = match;
  return `${day}.${month}.${year}`;
}

const GERMAN_DAY = /^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/;
const ISO_DAY = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
/** A day with the month in words (`1. März 2026`, `1 Nov 2026`). */
const NAMED_DAY = /^(\d{1,2})\.?\s+(\p{L}+)\.?\s+(\d{4})$/u;
/** The month of a name by its first three letters (umlauts folded: `mär` is `mar`). */
const MONTH_OF: Readonly<Record<string, number>> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  mai: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  okt: 10,
  nov: 11,
  dez: 12,
};
const monthOf = (name: string): number =>
  MONTH_OF[name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().slice(0, 3)] ?? 0;

/**
 * A typed day (`1.11.2026`, `01.11.26`, `01/11/2026`, `2026-11-01`, `1 Nov 2026`) as
 * `YYYY-MM-DD`; `null` if it is none. Day first.
 */
export function isoDate(text: string): string | null {
  const value = text.trim();
  const german = GERMAN_DAY.exec(value);
  const iso = ISO_DAY.exec(value);
  const named = NAMED_DAY.exec(value);
  const [year, month, day] = german
    ? [
        Number(german[3]) + (german[3]!.length === 2 ? 2000 : 0),
        Number(german[2]),
        Number(german[1]),
      ]
    : iso
      ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
      : named
        ? [Number(named[3]), monthOf(named[2]!), Number(named[1])]
        : [0, 0, 0];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  const valid = year > 1900 && day >= 1 && day <= days;
  return valid ? `${year}-${pad(month)}-${pad(day)}` : null;
}

/** A typed day in a form `isoDate` reads, whether or not the calendar has it (`31.02.2026`). */
export function dayShaped(text: string): boolean {
  const value = text.trim();
  return GERMAN_DAY.test(value) || ISO_DAY.test(value) || NAMED_DAY.test(value);
}

/** The form's day (`dd.mm.yyyy`) of a typed one: its own text while it does not read. */
export function keptDate(text: string): string {
  const iso = isoDate(text);
  return iso === null ? text.trim() : shownDate(iso);
}

// ------------------------------------------------------------------ the editor

class ProfileEditor {
  /** `null`: nothing in the editor (no profile yet, or the view has not opened one). */
  origin = $state<DraftOrigin | null>(null);
  before = $state.raw<ProfileForm>(emptyForm());
  after = $state<ProfileForm>(emptyForm());
  /** The day of "Verfügbar" as typed, kept for "Ab Datum" while "Sofort" is chosen. */
  dateText = $state('');
  /** The day is judged (said when it does not read): once its field is left or on saving, never
   *  while it is typed. */
  judged = $state(false);
  /** Someone asked for what is missing (Ergänzen, Weiter, Profil ergänzen): it stays marked until
   *  it is filled, a look at another view changes nothing; until then the rows stay calm. */
  asked = $state(false);
  /** Text typed into a chip field that is no chip yet: a change like any other. */
  readonly typed = new TypedText();

  /** What was last sent to be saved, as the form had it. */
  #sent: ProfileForm = emptyForm();

  /** Unsaved: a change of the form, or text typed into a tag field. */
  get dirty(): boolean {
    if (this.origin === null) return false;
    return this.typed.any || this.changed;
  }

  /** The form differs from what is stored. */
  get changed(): boolean {
    return this.origin !== null && !sameForm(this.before, this.#done);
  }

  /** "Ab Datum" with its day still empty: not done yet, so it holds nothing. */
  get #dayWaits(): boolean {
    return this.after.available.kind === 'from' && this.dateText.trim() === '';
  }

  /** The form as far as it is done: what is stored stands for a day still empty. */
  get #done(): ProfileForm {
    return this.#dayWaits ? { ...this.after, available: this.before.available } : this.after;
  }

  #start(origin: DraftOrigin, before: ProfileForm, after: ProfileForm): void {
    // A form with a day writes it; one without keeps it for "Ab Datum" while the form goes on.
    if (after.available.kind === 'from') this.dateText = after.available.date;
    else if (this.origin === null) this.dateText = '';
    this.origin = origin;
    this.before = copy(before);
    this.after = copy(after);
    this.judged = false;
  }

  /** The stored profile (again, e.g. after a save). */
  edit(form: ProfileForm): void {
    this.#start('stored', form, form);
  }

  /** "Selbst ausfüllen": the form of a new profile. */
  create(): void {
    this.#start('new', emptyForm(), emptyForm());
  }

  /** Nothing in the editor (the ways in show). */
  close(): void {
    this.#start('stored', emptyForm(), emptyForm());
    this.origin = null;
    this.asked = false;
  }

  /** "Ab Datum" is chosen and text stands as its day that does not read. */
  get dateInvalid(): boolean {
    return (
      this.after.available.kind === 'from' && !this.#dayWaits && isoDate(this.dateText) === null
    );
  }

  /** Verfügbar goes back to what was handed out, with its day. */
  storedDay(): void {
    const stored = this.before.available;
    this.after.available = structuredClone(stored);
    this.dateText = stored.kind === 'from' ? stored.date : '';
  }

  /** The view goes: a day still empty was never given, what is stored stands. */
  endDay(): void {
    if (this.#dayWaits) this.storedDay();
  }

  /** A value the backend refused goes back to what was handed out: a list's row by its name (one
   *  that was not handed out goes), any other value whole; what the form does not hold, nothing. */
  restore(field: string, row: number | null): void {
    if (field === 'available') this.storedDay();
    else if (field === 'competences' && row !== null) {
      this.after.competences = rowBack(
        this.after.competences,
        this.before.competences,
        row,
        (each) => each.name,
      );
    } else if (field === 'languages' && row !== null) {
      this.after.languages = rowBack(
        this.after.languages,
        this.before.languages,
        row,
        (each) => each.language,
      );
    } else if (field in this.after) {
      Object.assign(this.after, {
        [field]: structuredClone((this.before as Record<string, unknown>)[field]),
      });
    }
  }

  /** Drops the changes: the stored profile as saved, or no form at all. */
  discard(stored: ProfileForm | null): void {
    this.typed.clear();
    this.close();
    if (stored !== null) this.edit(stored);
  }

  /** Writes the form; the caller reloads the app state (and with it the stored form). */
  save(): Promise<ProfileInfo> {
    const before = copy(this.before);
    this.#sent = copy(this.after);
    const after = normalized(copy(this.#done));
    return serial(() => send(before, after));
  }

  /** A save is done and `form` is what the file holds now: the form shows it, and what was
   *  changed while the save was under way stays a change. "Ab Datum" stays chosen with its day
   *  still empty. */
  settle(form: ProfileForm): void {
    if (sameForm(this.after, this.#sent)) {
      const waits = this.#dayWaits;
      this.edit(form);
      if (waits) {
        this.after.available = { kind: 'from', date: '' };
        this.dateText = '';
      }
    } else {
      this.origin = 'stored';
      this.before = copy(form);
    }
  }
}

export const editor = new ProfileEditor();

/** The saves of the profile, one after the other: each starts once the one before is written
 *  and the state is loaded again (DS-3), so two quick saves never write over each other. */
let saving: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = saving.then(task, task);
  saving = next.catch(() => undefined);
  return next;
}

/** The stored profile changed by `change`, saved like a save of the form (the previous file
 *  is the backup, every job is scored again) and built on the profile as it is stored when
 *  its turn comes. `false` when nothing changes or there is no profile. */
function saveStored(change: (form: ProfileForm) => void): Promise<boolean> {
  return serial(async () => {
    const stored = app.state?.profile?.form ?? null;
    if (stored === null) return false;
    const before = copy(stored);
    const changed = copy(stored);
    change(changed);
    const after = normalized(changed);
    if (sameForm(after, before)) return false;
    await send(before, after);
    await app.load();
    return true;
  });
}

/**
 * The reader's "+": a term the ads ask for goes into its field of the stored profile (the
 * tool "Anaplan" into the tools), saved at once. Returns its undo, which takes out this term
 * only (a term added meanwhile stays); null when the field names it already or there is no
 * profile. Refused while the form holds a change that is not saved yet (it comes first).
 */
export async function addToProfile(term: ProfileTerm): Promise<(() => Promise<void>) | null> {
  if (editor.dirty) return null;
  const put: ProfileTerm = { term: term.term.trim(), field: term.field };
  if (!(await saveStored((form) => void putTerm(form, put)))) return null;
  return async () => {
    await saveStored((form) => takeTerm(form, put));
  };
}
