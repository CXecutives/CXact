// The profile editor (Profil view): the form as it was handed out (`before`), the form as
// the user has it (`after`) and where it came from. Saving sends both; the backend writes
// only what differs and keeps every other key of the file. A draft (a new profile, a chosen
// file, also the one an AI wrote with the app's prompt) is unsaved until it is saved; the
// stored profile only once something differs. Leaving the view or closing the window with unsaved changes asks first
// (ProfileView holds the guard and the dialog).
//
// Values of the file the engine could not read are said at their field (`fieldProblems`);
// "Wert entfernen" clears one (`clear`), saving then removes its keys. Quality and the empty
// sections follow the form while typing (`localQuality`, with the engine's thresholds).
//
// The criteria, their limits and the empty form come from core (`types/profile.ts`, written
// from `core/src/profile/form.rs`): a new number or word criterion needs nothing here.

import { language } from '../i18n/language.svelte';
import { invoke } from '../ipc/api';
import { app } from './app.svelte';
import type {
  Notice,
  ProfileCompetence,
  ProfileCriteria,
  ProfileDraft,
  ProfileForm,
  ProfileInfo,
  ProfileLanguage,
  ProfileQuality,
  ProfileUnderstanding,
  UnreadableField,
} from '../ipc/types';
import {
  EMPTY_FORM,
  MAX_FOCUS,
  NUMBER_CRITERIA,
  UNREADABLE_FIELDS,
  WORD_CRITERIA,
  type NumberCriterion,
  type WordCriterion,
} from '../ipc/types/profile';
import { putTerm, takeTerm, type ProfileTerm } from './terms';
import { TypedText } from './typed.svelte';

export { MAX_FOCUS };

/** Where the form in the editor came from: the stored profile, a new one or a chosen file. */
export type DraftOrigin = 'stored' | 'new' | 'file';

/** Fewer terms than this make a thin profile (the engine's `THIN_BELOW`). */
const THIN_BELOW = 5;

/** The JSON a new profile is written into. */
const NEW_SOURCE = '{}';

/** The empty form of the backend (`ProfileForm::default()`; "remote outside" is allowed,
 *  as the engine reads a missing value). */
export function emptyForm(): ProfileForm {
  return structuredClone(EMPTY_FORM);
}

const NUMBER_KEYS = Object.keys(NUMBER_CRITERIA) as NumberCriterion[];
const WORD_KEYS = Object.keys(WORD_CRITERIA) as WordCriterion[];
const isCriterion = (field: UnreadableField): field is NumberCriterion | WordCriterion =>
  field in NUMBER_CRITERIA || field in WORD_CRITERIA;

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

const positive = (value: number | null | undefined): number | null =>
  value !== null && value !== undefined && value > 0 ? value : null;

/** The criteria the way the backend compares them (`ProfileCriteria::normalized`): numbers of
 *  zero as none, words trimmed and each once, in the backend's order of the keys. */
function normalizedCriteria(c: ProfileCriteria): ProfileCriteria {
  const out: ProfileCriteria = {
    ...EMPTY_FORM.criteria,
    noAnue: c.noAnue,
    noPermanent: c.noPermanent,
    available:
      c.available.kind === 'from' ? { kind: 'from', date: c.available.date.trim() } : c.available,
    remoteOutside: c.remoteOutside,
  };
  for (const key of NUMBER_KEYS) out[key] = positive(c[key]);
  for (const key of WORD_KEYS) {
    const words = WORD_CRITERIA[key].upper ? c[key].map((word) => word.toUpperCase()) : c[key];
    out[key] = cleanList(words);
  }
  return out;
}

/** The form the way the backend compares it (trimmed, empty rows and entries gone). */
export function normalized(form: ProfileForm): ProfileForm {
  const competences: ProfileCompetence[] = form.competences
    .filter((row) => row.name.trim() !== '')
    .map((row) => ({ ...row, name: row.name.trim(), aliases: cleanList(row.aliases) }));
  const languages: ProfileLanguage[] = form.languages
    .filter((row) => row.language.trim() !== '')
    .map((row) => ({ ...row, language: row.language.trim() }));
  return {
    name: form.name.trim(),
    title: form.title.trim(),
    competences,
    strengths: cleanList(form.strengths),
    keywords: cleanList(form.keywords),
    years: form.years,
    degrees: cleanList(form.degrees),
    industries: cleanList(form.industries),
    tools: cleanList(form.tools),
    certificates: cleanList(form.certificates),
    languages,
    focus: cleanList(form.focus),
    roles: cleanList(form.roles),
    searchTerms: cleanList(form.searchTerms),
    searchTermsProposed: form.searchTermsProposed,
    wishes: {
      dayRate: positive(form.wishes.dayRate),
      remote: form.wishes.remote,
      regions: cleanList(form.wishes.regions),
      industries: cleanList(form.wishes.industries),
    },
    criteria: normalizedCriteria(form.criteria),
  };
}

export function sameForm(a: ProfileForm, b: ProfileForm): boolean {
  return JSON.stringify(normalized(a)) === JSON.stringify(normalized(b));
}

const copy = (form: ProfileForm): ProfileForm => structuredClone($state.snapshot(form));

// ------------------------------------------------------------------ quality

/** The texts of the form the engine counts as terms for the quality: the role, the
 *  competences, the lists of the experience and the strengths and keywords (its other words
 *  and wishes do not count). */
function terms(form: ProfileForm): number {
  const n = normalized(form);
  return cleanList([
    n.title,
    ...n.competences.map((row) => row.name),
    ...n.strengths,
    ...n.keywords,
    ...n.degrees,
    ...n.industries,
    ...n.tools,
    ...n.certificates,
    ...n.languages.map((row) => row.language),
  ]).length;
}

/**
 * The quality of the form as the user has it, with the engine's thresholds (no terms empty,
 * fewer than five thin): the engine's count for what the form started with (it also counts
 * what only the file holds, the career stations), moved by what the form changed.
 */
export function localQuality(
  counted: number,
  before: ProfileForm,
  after: ProfileForm,
): { quality: ProfileQuality; terms: number } {
  const count = Math.max(0, counted - terms(before) + terms(after));
  const quality: ProfileQuality = count === 0 ? 'empty' : count < THIN_BELOW ? 'thin' : 'good';
  return { quality, terms: count };
}

// ------------------------------------------------------------------ values that did not read

/** A value the backend refused on saving: the field (and row) it names and its words (said
 *  when they show, so they follow a switch of the language). */
export interface FieldError {
  field: string;
  row: number | null;
  text: () => string;
}

/** A value of the file the engine could not read, at the field of the form that holds it. */
export interface FieldProblem {
  field: UnreadableField;
  /** The engine's warning (the head names it in its tooltip). */
  notice: Notice;
  /** The value as the file had it (a JSON text loses its quotes). */
  value: string;
  /** One entry of a list does not count (a Schwerpunkt that is no competence, a target role
   *  without a field), not the whole value: removing it is removing the entry. */
  entry: boolean;
}

const isField = (value: unknown): value is UnreadableField =>
  typeof value === 'string' && (UNREADABLE_FIELDS as readonly string[]).includes(value);

/** The value of a field of the form, to see whether the user changed it: a number or word
 *  criterion by its key, the others by hand. */
function fieldValue(form: ProfileForm, field: UnreadableField): unknown {
  const c = form.criteria;
  const w = form.wishes;
  if (isCriterion(field)) return c[field];
  switch (field) {
    case 'contracts':
      return [c.noAnue, c.noPermanent];
    case 'remoteOutside':
      return c.remoteOutside;
    case 'available':
      return c.available;
    case 'focus':
      return form.focus;
    case 'roles':
      return form.roles;
    case 'wishDayRate':
      return w.dayRate;
    case 'remote':
      return w.remote;
    case 'regions':
      return w.regions;
    case 'wishIndustries':
      return w.industries;
  }
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/^"(.*)"$/, '$1') : String(value ?? '');

/**
 * The values of the file the engine could not read that are still there: not removed with
 * "Wert entfernen" (`cleared`) and not replaced by a new value in the form. A Schwerpunkt or a
 * target role that does not count is fixed once it is gone from its list (or, for a
 * Schwerpunkt, once a competence carries its name).
 */
export function fieldProblems(
  warnings: readonly Notice[],
  before: ProfileForm,
  after: ProfileForm,
  cleared: readonly UnreadableField[],
): FieldProblem[] {
  const out: FieldProblem[] = [];
  for (const notice of warnings) {
    const field = notice.code === 'availabilityNotUnderstood' ? 'available' : notice.params.field;
    if (!isField(field) || cleared.includes(field)) continue;
    const value = text(notice.params.value);
    const list = field === 'focus' ? before.focus : field === 'roles' ? before.roles : [];
    const entry = list.some((item) => same(item, value));
    if (entry) {
      const now = field === 'focus' ? after.focus : after.roles;
      const named =
        field === 'focus' && after.competences.some((row) => same(row.name.trim(), value));
      if (!now.some((item) => same(item, value)) || named) continue;
    } else if (
      JSON.stringify(fieldValue(before, field)) !== JSON.stringify(fieldValue(after, field))
    ) {
      continue;
    }
    out.push({ field, notice, value, entry });
  }
  return out;
}

// ------------------------------------------------------------------ dates

const pad = (value: number): string => String(value).padStart(2, '0');

/** A day as British English writes it, the month in words (`1 Nov 2026`). */
const BRITISH_DAY = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** `2026-11-01` -> `01.11.2026`, in English `1 Nov 2026` (as the field shows a day). */
export function shownDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match === null) return iso;
  const [, year, month, day] = match;
  return language.current === 'de'
    ? `${day}.${month}.${year}`
    : BRITISH_DAY.format(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

const GERMAN_DAY = /^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/;
const ISO_DAY = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
/** A day with the month in words, German or English (`1 Nov 2026`, `1. März 2026`). */
const NAMED_DAY = /^(\d{1,2})\.?\s+(\p{L}+)\.?\s+(\d{4})$/u;
/** The month of a name by its first three letters (umlauts folded: `mär` is `mar`). */
const MONTH_OF: Readonly<Record<string, number>> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  mai: 5,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  okt: 10,
  oct: 10,
  nov: 11,
  dez: 12,
  dec: 12,
};
const monthOf = (name: string): number =>
  MONTH_OF[name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().slice(0, 3)] ?? 0;

/**
 * A typed day (`1.11.2026`, `01.11.26`, `01/11/2026`, `2026-11-01`, `1 Nov 2026`) as
 * `YYYY-MM-DD`; `null` if it is none. Day first in both languages (German and British
 * English).
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

/** The day field's text for a form. */
const dateTextOf = (form: ProfileForm): string =>
  form.criteria.available.kind === 'from' ? shownDate(form.criteria.available.date) : '';

// ------------------------------------------------------------------ the editor

class ProfileEditor {
  /** `null`: nothing in the editor (no profile yet, or the view has not opened one). */
  origin = $state<DraftOrigin | null>(null);
  /** The draft becomes a new profile beside the others when it is saved (the menu's Neues
   *  Profil and Aus Datei laden): nothing is written before "Speichern", "Verwerfen" goes
   *  back to the active profile as it was. */
  fresh = $state(false);
  before = $state.raw<ProfileForm>(emptyForm());
  after = $state<ProfileForm>(emptyForm());
  source = $state<string | null>(null);
  /** How much the engine understands of a draft (the stored profile has its own). */
  quality = $state<ProfileQuality | null>(null);
  /** What the engine reads in a chosen file (its warnings, its terms). */
  understood = $state.raw<ProfileUnderstanding | null>(null);
  /** Values of the file the user removed ("Wert entfernen"); saving removes their keys. */
  cleared = $state<UnreadableField[]>([]);
  /** The day of "Verfügbar ab" as typed (the form holds it as `YYYY-MM-DD`). */
  dateText = $state('');
  /** The day is judged (said when it does not read): once its field is left with text in it
   *  or on saving, never while it is typed. */
  judged = $state(false);
  /** Text typed into a chip field that is no chip yet: a change like any other. */
  readonly typed = new TypedText();

  /** Unsaved: a chosen file as it is, else a change of the form. */
  get dirty(): boolean {
    if (this.origin === null) return false;
    if (this.origin === 'file') return true;
    return this.changed;
  }

  /** The form differs from what it was handed out as (a draft that was changed, too). */
  get changed(): boolean {
    if (this.origin === null) return false;
    return this.cleared.length > 0 || this.typed.any || !sameForm(this.before, this.after);
  }

  #start(origin: DraftOrigin, before: ProfileForm, after: ProfileForm): void {
    this.origin = origin;
    this.before = copy(before);
    this.after = copy(after);
    this.dateText = dateTextOf(after);
    this.judged = false;
    this.cleared = [];
  }

  /** The stored profile (again, e.g. after a save). */
  edit(form: ProfileForm): void {
    this.#start('stored', form, form);
    this.fresh = false;
    this.source = null;
    this.quality = null;
    this.understood = null;
  }

  /** An empty form for a new profile, with one empty competence and language row (at B2,
   *  the level the engine assumes), so the table and the star show at once; `fresh`: saved
   *  beside the other profiles. */
  create(fresh = false): void {
    this.fresh = fresh;
    this.#start('new', emptyForm(), {
      ...emptyForm(),
      competences: [{ name: '', years: null, aliases: [], origin: null }],
      languages: [{ language: '', level: 'b2', origin: null }],
    });
    this.source = NEW_SOURCE;
    this.quality = null;
    this.understood = null;
    profileTab.value = PROFILE_TABS[0];
  }

  /** A chosen file, to review before it is saved; `fresh`: saved beside the other
   *  profiles. */
  take(draft: ProfileDraft, fresh = false): void {
    this.fresh = fresh;
    this.#start('file', draft.form, draft.form);
    this.source = draft.source;
    this.quality = draft.quality;
    this.understood = draft.understood;
    profileTab.value = PROFILE_TABS[0];
  }

  /** Nothing in the editor (the empty state shows). */
  close(): void {
    this.#start('stored', emptyForm(), emptyForm());
    this.origin = null;
    this.fresh = false;
    this.source = null;
    this.quality = null;
    this.understood = null;
  }

  /** "Wert entfernen": the value of the file goes when the profile is saved. */
  clear(field: UnreadableField): void {
    if (!this.cleared.includes(field)) this.cleared = [...this.cleared, field];
  }

  /** "Ab Datum" is chosen but the day does not read. */
  get dateInvalid(): boolean {
    return this.after.criteria.available.kind === 'from' && isoDate(this.dateText) === null;
  }

  /** Drops the changes: the stored profile as saved, or no draft at all. */
  discard(stored: ProfileForm | null): void {
    this.typed.clear();
    if (stored !== null) this.edit(stored);
    else this.close();
  }

  /** Writes the form; the caller reloads the app state (and with it the stored form). */
  save(): Promise<ProfileInfo> {
    const save = {
      before: copy(this.before),
      after: normalized(copy(this.after)),
      source: this.source,
      clear: [...this.cleared],
    };
    return serial(() => invoke('save_profile', { save }));
  }
}

export const editor = new ProfileEditor();

/** The tabs of the Profil in their order (user decision 2026-10-01): what she looks for,
 *  what she can, her experience, what excludes a job. */
export const PROFILE_TABS = ['search', 'skills', 'experience', 'exclusions'] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];

/** The tab the Profil shows, a place for Zurück and Vor; a new or loaded profile starts at
 *  the first. */
export const profileTab = $state<{ value: ProfileTab }>({ value: PROFILE_TABS[0] });

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
    await invoke('save_profile', { save: { before, after, source: null, clear: [] } });
    await app.load();
    return true;
  });
}

/**
 * The reader's "+": a term the ads ask for goes into its field of the stored profile (the
 * tool "Anaplan" into the tools), saved at once. Returns its undo, which takes out this term
 * only (a term added meanwhile stays); null when the field names it already or there is no
 * profile. Refused while the form holds unsaved changes (they come first).
 */
export async function addToProfile(term: ProfileTerm): Promise<(() => Promise<void>) | null> {
  if (editor.dirty) return null;
  const put: ProfileTerm = { term: term.term.trim(), field: term.field };
  if (!(await saveStored((form) => void putTerm(form, put)))) return null;
  return async () => {
    await saveStored((form) => takeTerm(form, put));
  };
}
