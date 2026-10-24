// The Profil form as data: the fields of the page in four groups (Wunschjob, Einsatz,
// Qualifikation, Ausschlüsse; the round 10 draft), the same page in the setup.
// ProfileEditor renders these tables and nothing else, so adding, moving or removing a field
// is one entry here (docs/CHANGING.md "Change the Profil form"). A field names the value of
// the form it edits, its control, its words by their key in the catalog (`t.profile.field`)
// and, at the few places docs/PLAN.md names, its info symbol (`t.profile.info`). Controls with
// more to them than a field (the competences, the industries, the languages, the countries,
// the day) are components the table names by their kind. A row holds one field, or a pair of
// two short ones side by side where the group is wide enough (`pair`; the second may stay
// empty, so a short field keeps its half). One kind of control per kind of value: free
// values a tag field, several of a few checkboxes, one of a few modes segments, a value on a
// scale a select, an amount a number with its unit, entries with a value an item list.

import type { Catalog } from '$lib/i18n/de';
import type { ProfileForm, TermField } from '$lib/ipc/types';

type Words = Catalog['profile']['field'];
/** A text of the form in the catalog (`t.profile.field`), by its key. */
export type Word = { [K in keyof Words]: Words[K] extends string ? K : never }[keyof Words];
/** The unit inside a number field (`t.profile.unit`). */
export type Unit = keyof Catalog['profile']['unit'];
/** An info symbol's sentence (`t.profile.info`). */
export type Info = keyof Catalog['profile']['info'];

/** A number of the form. */
export type NumberKey = 'dayRateWish' | 'dayRateMin' | 'minSalary' | 'years';
/** A list of words of the form. */
export type ListKey = 'roles' | 'regions' | 'tools' | 'degrees' | 'certificates' | 'exclusionWords';
/** The words a tag field suggests while typing (vocabulary.svelte.ts). */
export type Suggest = 'roles' | 'skills' | 'industries' | 'regions';
/** A choice of a few modes, one segmented control each. */
export type ChoiceKey = 'workMode' | 'workload';

/** A field of the form. `shown` keeps its row out of the form while the values it depends on
 *  say it has nothing to do. */
export type Control =
  | {
      kind: 'number';
      key: NumberKey;
      label: Word;
      unit: Unit;
      info?: Info;
      shown?: (form: ProfileForm) => boolean;
      testid: string;
    }
  | {
      kind: 'chips';
      key: ListKey;
      label: Word;
      placeholder: Word;
      info?: Info;
      /** Entries are names that may hold commas: only a line break splits a pasted list. */
      lines?: true;
      suggest?: Suggest;
      /** The terms of this field the jobs ask for, under it ("Häufig verlangt"). */
      asked?: TermField;
      testid: string;
    }
  /** The contract types (`profile.contract`), a choice of several. */
  | { kind: 'contracts'; info: Info }
  | { kind: 'choice'; key: ChoiceKey; label: Word; testid: string }
  /** Mindestlaufzeit, a value on a scale. */
  | { kind: 'months' }
  | { kind: 'countries'; info: Info }
  | { kind: 'available' }
  | { kind: 'competences' }
  | { kind: 'industries' }
  | { kind: 'languages' };

/** A row of a group: one field, or two short ones side by side (null: the second half stays
 *  empty). */
export type Row = Control | { pair: readonly [Control, Control | null] };

export type SectionId = keyof Catalog['profile']['section'];

export interface Section {
  id: SectionId;
  /** Its rows, one under the other. */
  rows: readonly Row[];
}

const chips = (
  key: ListKey,
  testid: string,
  more: Partial<Extract<Control, { kind: 'chips' }>> = {},
): Control => ({
  kind: 'chips',
  key,
  label: key,
  placeholder: `${key}Placeholder` as Word,
  testid,
  ...more,
});

const pair = (first: Control, second: Control | null = null): Row => ({
  pair: [first, second],
});

export const SECTIONS: readonly Section[] = [
  {
    id: 'job',
    rows: [
      chips('roles', 'profile-roles', { suggest: 'roles' }),
      { kind: 'contracts', info: 'contracts' },
      pair(
        {
          kind: 'number',
          key: 'dayRateWish',
          label: 'dayRateWish',
          unit: 'day',
          testid: 'profile-wish-rate',
        },
        {
          kind: 'number',
          key: 'dayRateMin',
          label: 'dayRateMin',
          unit: 'day',
          info: 'dayRate',
          testid: 'profile-min-rate',
        },
      ),
      // The salary counts for Festanstellung and Zeitarbeit only.
      pair({
        kind: 'number',
        key: 'minSalary',
        label: 'minSalary',
        unit: 'year',
        shown: (form) => form.permanent || form.temporary,
        testid: 'profile-min-salary',
      }),
    ],
  },
  {
    id: 'work',
    rows: [
      { kind: 'countries', info: 'countries' },
      chips('regions', 'profile-regions', { suggest: 'regions' }),
      pair(
        { kind: 'choice', key: 'workMode', label: 'workMode', testid: 'profile-work-mode' },
        { kind: 'choice', key: 'workload', label: 'workload', testid: 'profile-workload' },
      ),
      pair({ kind: 'available' }, { kind: 'months' }),
    ],
  },
  {
    id: 'skills',
    rows: [
      pair({
        kind: 'number',
        key: 'years',
        label: 'totalYears',
        unit: 'years',
        testid: 'profile-years',
      }),
      { kind: 'competences' },
      chips('tools', 'profile-tools', { suggest: 'skills', asked: 'tool' }),
      { kind: 'industries' },
      { kind: 'languages' },
      pair(
        chips('degrees', 'profile-degrees', { lines: true, asked: 'degree' }),
        chips('certificates', 'profile-certificates', { lines: true, asked: 'certificate' }),
      ),
    ],
  },
  {
    id: 'exclusions',
    rows: [chips('exclusionWords', 'profile-exclusion-words', { info: 'exclusionWords' })],
  },
];

/** The fields of a row, in their order. */
export const controlsOf = (row: Row): Control[] =>
  'pair' in row ? row.pair.filter((control) => control !== null) : [row];

/** The value of the form a control edits (the fields `ProfileInfo.missing` names). */
export function fieldOf(control: Control): keyof ProfileForm {
  switch (control.kind) {
    case 'number':
    case 'chips':
    case 'choice':
      return control.key;
    case 'contracts':
      return 'project';
    case 'months':
      return 'minMonths';
    default:
      return control.kind;
  }
}

/** Every value of the form in the order of the page (the first marked one is revealed). */
export const FIELD_ORDER: readonly (keyof ProfileForm)[] = SECTIONS.flatMap((section) =>
  section.rows.flatMap(controlsOf).map(fieldOf),
);

/** The label of a field (`t.profile.field`) where its key is not the value's name. */
export const LABEL_OF: Readonly<Partial<Record<keyof ProfileForm, Word>>> = {
  years: 'totalYears',
  project: 'contracts',
  permanent: 'contracts',
  temporary: 'contracts',
};

/** The value of a field holds nothing (a required field still to fill). */
export function blank(form: ProfileForm, field: string): boolean {
  const value = (form as Record<string, unknown>)[field];
  if (Array.isArray(value)) {
    return value.every((entry: unknown) =>
      typeof entry === 'string'
        ? entry.trim() === ''
        : typeof entry === 'object' && entry !== null && 'name' in entry
          ? String(entry.name).trim() === ''
          : typeof entry === 'object' && entry !== null && 'language' in entry
            ? String(entry.language).trim() === ''
            : false,
    );
  }
  return value === null || value === undefined;
}
