// The Profil form as data: its groups in their order (Wunschjob, Einsatz, Erfahrung,
// Kompetenzen, Sprachen, Ausschlüsse; the owner's redesign of 2026-10-24), the same page in the
// setup. ProfileEditor renders these tables and nothing else, so adding, moving or removing a
// field is one entry here (docs/CHANGING.md "Change the Profil form"). A group is a box of
// rows, one field each with its label beside it, or a box whose rows are the entries of one
// list (`list`: the competences, the languages). A field names the value of the form it
// edits, its control, its words by their key in the catalog (`t.profile.field`) and, at the
// few places docs/PLAN.md names, its info symbol (`t.profile.info`). Controls with more to
// them than a field (the countries, the day) are components the table names by their kind.
// One kind of control per kind of value: free values a tag field, several of a few
// checkboxes, one of a few and a value on a scale a select, an amount a number with its unit,
// entries with a value a box of entries. The Profil reads the same table as text while a
// group is closed (ProfileEditor).

import type { Catalog } from '$lib/i18n/de';
import type { ProfileForm } from '$lib/ipc/types';

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
export type ListKey =
  'roles' | 'regions' | 'tools' | 'industries' | 'degrees' | 'certificates' | 'exclusionWords';
/** The words a tag field suggests while typing (vocabulary.svelte.ts). */
export type Suggest = 'roles' | 'skills' | 'industries' | 'regions';
/** A choice of a few modes, one segmented control each. */
export type ChoiceKey = 'workMode' | 'workload';

/** A field of the form, a row of its group's box. `shown` keeps its row out of the form while
 *  the values it depends on say it has nothing to do. */
export type Control =
  | {
      kind: 'number';
      key: NumberKey;
      label: Word;
      unit: Unit;
      /** What an empty field means. */
      placeholder?: Word;
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
      testid: string;
    }
  /** The contract types (`profile.contract`), a choice of several. */
  | { kind: 'contracts'; info: Info }
  | { kind: 'choice'; key: ChoiceKey; label: Word; testid: string }
  /** Mindestlaufzeit, a value on a scale. */
  | { kind: 'months' }
  | { kind: 'countries'; info: Info }
  | { kind: 'available' };

/** A list of entries with a value, a group of its own whose rows are its entries. */
export type EntryList = 'competences' | 'languages';

export type SectionId = keyof Catalog['profile']['section'];

export type Section =
  | {
      id: SectionId;
      /** Its fields, one row each. */
      rows: readonly Control[];
    }
  | { id: SectionId; list: EntryList };

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

export const SECTIONS: readonly Section[] = [
  {
    id: 'job',
    rows: [
      chips('roles', 'profile-roles', { suggest: 'roles' }),
      { kind: 'contracts', info: 'contracts' },
      // The day rates count for Projekt und Interim only, the salary for the other two.
      {
        kind: 'number',
        key: 'dayRateWish',
        label: 'dayRateWish',
        unit: 'day',
        shown: (form) => form.project,
        testid: 'profile-wish-rate',
      },
      {
        kind: 'number',
        key: 'dayRateMin',
        label: 'dayRateMin',
        unit: 'day',
        info: 'dayRate',
        shown: (form) => form.project,
        testid: 'profile-min-rate',
      },
      {
        kind: 'number',
        key: 'minSalary',
        label: 'minSalary',
        unit: 'year',
        placeholder: 'minSalaryPlaceholder',
        shown: (form) => form.permanent || form.temporary,
        testid: 'profile-min-salary',
      },
    ],
  },
  {
    id: 'work',
    rows: [
      { kind: 'countries', info: 'countries' },
      chips('regions', 'profile-regions', { suggest: 'regions' }),
      { kind: 'choice', key: 'workMode', label: 'workMode', testid: 'profile-work-mode' },
      { kind: 'choice', key: 'workload', label: 'workload', testid: 'profile-workload' },
      { kind: 'available' },
      { kind: 'months' },
    ],
  },
  {
    id: 'experience',
    rows: [
      {
        kind: 'number',
        key: 'years',
        label: 'totalYears',
        unit: 'years',
        testid: 'profile-years',
      },
      chips('tools', 'profile-tools', { suggest: 'skills' }),
      chips('industries', 'profile-industries', { suggest: 'industries' }),
      chips('degrees', 'profile-degrees', { lines: true }),
      chips('certificates', 'profile-certificates', { lines: true }),
    ],
  },
  { id: 'competences', list: 'competences' },
  { id: 'languages', list: 'languages' },
  {
    id: 'exclusions',
    rows: [chips('exclusionWords', 'profile-exclusion-words', { info: 'exclusionWords' })],
  },
];

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

/** Every value a control edits (Vertragsart edits three). */
export function fieldsOf(control: Control): (keyof ProfileForm)[] {
  if (control.kind === 'contracts') return ['project', 'permanent', 'temporary'];
  return [fieldOf(control)];
}

/** Every value of the form in the order of the page (the first marked one is revealed). */
export const FIELD_ORDER: readonly (keyof ProfileForm)[] = SECTIONS.flatMap((section) =>
  'list' in section ? [section.list] : section.rows.map(fieldOf),
);

/** The label of a field (`t.profile.field`) where its key is not the value's name. */
export const LABEL_OF: Readonly<Partial<Record<keyof ProfileForm, Word>>> = {
  years: 'totalYears',
  project: 'contracts',
  permanent: 'contracts',
  temporary: 'contracts',
};

/** The number fields of the form. */
export const NUMBERS = SECTIONS.flatMap((section) =>
  'rows' in section ? section.rows : [],
).filter((control) => control.kind === 'number');

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
