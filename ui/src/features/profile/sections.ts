// The Profil form as data: the fields of the page in four groups (Wunschjob, Einsatz,
// Qualifikation, Ausschlüsse; design round 6, "Luftige Gruppen"), the same page in the setup.
// ProfileEditor renders these tables and nothing else, so adding, moving or removing a field
// is one entry here (docs/CHANGING.md "Change the Profil form"). A field names the value of
// the form it edits, its control, its words by their key in the catalog (`t.profile.field`)
// and, at the few places docs/PLAN.md names, its info symbol (`t.profile.info`). Controls with
// more to them than a field (the competences, the industries, the languages, the countries,
// the day) are components the table names by their kind.

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
/** The words a chip field suggests while typing (vocabulary.svelte.ts). */
export type Suggest = 'roles' | 'skills' | 'industries' | 'regions';
/** A choice of a few, one segmented control each. */
export type ChoiceKey = 'workMode' | 'workload' | 'minMonths';

/** A field of the form. `shown` keeps it out of the form while the values it depends on say
 *  it has nothing to do. */
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
      /** The placeholder once it holds chips ("+ Rolle"). */
      more: Word;
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
  | { kind: 'choice'; key: ChoiceKey; label: Word; info?: Info; testid: string }
  | { kind: 'countries'; info: Info }
  | { kind: 'available' }
  | { kind: 'competences' }
  | { kind: 'industries' }
  | { kind: 'languages' };

export type SectionId = keyof Catalog['profile']['section'];

export interface Section {
  id: SectionId;
  /** Its fields, one under the other. */
  rows: readonly Control[];
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
  more: `${key}More` as Word,
  testid,
  ...more,
});

export const SECTIONS: readonly Section[] = [
  {
    id: 'job',
    rows: [
      chips('roles', 'profile-roles', { suggest: 'roles' }),
      { kind: 'contracts', info: 'contracts' },
      {
        kind: 'number',
        key: 'dayRateWish',
        label: 'dayRateWish',
        unit: 'euro',
        testid: 'profile-wish-rate',
      },
      {
        kind: 'number',
        key: 'dayRateMin',
        label: 'dayRateMin',
        unit: 'euro',
        info: 'dayRate',
        testid: 'profile-min-rate',
      },
      {
        // The salary counts for Festanstellung and Zeitarbeit only.
        kind: 'number',
        key: 'minSalary',
        label: 'minSalary',
        unit: 'euro',
        shown: (form) => form.permanent || form.temporary,
        testid: 'profile-min-salary',
      },
    ],
  },
  {
    id: 'work',
    rows: [
      { kind: 'choice', key: 'workMode', label: 'workMode', testid: 'profile-work-mode' },
      { kind: 'countries', info: 'countries' },
      chips('regions', 'profile-regions', { suggest: 'regions' }),
      { kind: 'available' },
      { kind: 'choice', key: 'workload', label: 'workload', testid: 'profile-workload' },
      { kind: 'choice', key: 'minMonths', label: 'minMonths', testid: 'profile-min-months' },
    ],
  },
  {
    id: 'skills',
    rows: [
      { kind: 'competences' },
      chips('tools', 'profile-tools', { suggest: 'skills', asked: 'tool' }),
      {
        kind: 'number',
        key: 'years',
        label: 'totalYears',
        unit: 'years',
        testid: 'profile-years',
      },
      { kind: 'industries' },
      { kind: 'languages' },
      chips('degrees', 'profile-degrees', { lines: true, asked: 'degree' }),
      chips('certificates', 'profile-certificates', { lines: true, asked: 'certificate' }),
    ],
  },
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
    default:
      return control.kind;
  }
}

/** Every value of the form in the order of the page (the missing sentence names them so). */
export const FIELD_ORDER: readonly (keyof ProfileForm)[] = SECTIONS.flatMap((section) =>
  section.rows.map(fieldOf),
);

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
