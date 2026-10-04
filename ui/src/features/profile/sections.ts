// The Profil form as data: the fields of the page in three sections (Was du suchst, Was du
// mitbringst, Was nicht passt; user decision 2026-10-03, design B "Luftig" since round 4),
// the same page in the setup. ProfileEditor renders these tables and nothing else, so adding,
// moving or removing a field is one entry here (docs/CHANGING.md "Add a profile field"). A
// field names the value of the form it edits, its control, its words by their key in the
// catalog (`t.profile.field`) and, at the few places docs/PLAN.md names, its info symbol
// (`t.profile.info`). Two small fields may stand side by side (`pair`). Controls with more to
// them than a field (the competences, the industries, the languages, the countries, the day)
// are components the table names by their kind.

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
  /** Vertragsart: Projekt und Interim, Festanstellung, Zeitarbeit, a choice of several. */
  | { kind: 'contracts'; info: Info }
  | { kind: 'choice'; key: ChoiceKey; label: Word; info?: Info; testid: string }
  | { kind: 'countries'; info: Info }
  | { kind: 'available' }
  | { kind: 'competences'; info: Info }
  | { kind: 'industries'; info: Info }
  | { kind: 'languages' };

/** A line of a section: one field, or two small ones side by side (one under the other in a
 *  narrow window; a single one takes the left half). */
export type Row = Control | { kind: 'pair'; items: readonly Control[] };

export type SectionId = keyof Catalog['profile']['section'];

export interface Section {
  id: SectionId;
  rows: readonly Row[];
}

export const SECTIONS: readonly Section[] = [
  {
    id: 'search',
    rows: [
      {
        kind: 'chips',
        key: 'roles',
        label: 'roles',
        placeholder: 'rolesPlaceholder',
        more: 'rolesMore',
        info: 'roles',
        suggest: 'roles',
        testid: 'profile-roles',
      },
      { kind: 'contracts', info: 'contracts' },
      {
        // The salary counts for Festanstellung and Zeitarbeit only.
        kind: 'pair',
        items: [
          {
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
        kind: 'pair',
        items: [
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
        ],
      },
      {
        kind: 'choice',
        key: 'workMode',
        label: 'workMode',
        info: 'workMode',
        testid: 'profile-work-mode',
      },
      { kind: 'countries', info: 'countries' },
      {
        kind: 'chips',
        key: 'regions',
        label: 'regions',
        placeholder: 'regionsPlaceholder',
        more: 'regionsMore',
        suggest: 'regions',
        testid: 'profile-regions',
      },
      {
        kind: 'pair',
        items: [
          { kind: 'available' },
          { kind: 'choice', key: 'workload', label: 'workload', testid: 'profile-workload' },
        ],
      },
      { kind: 'choice', key: 'minMonths', label: 'minMonths', testid: 'profile-min-months' },
    ],
  },
  {
    id: 'skills',
    rows: [
      { kind: 'competences', info: 'competences' },
      {
        kind: 'chips',
        key: 'tools',
        label: 'tools',
        placeholder: 'toolsPlaceholder',
        more: 'toolsMore',
        suggest: 'skills',
        asked: 'tool',
        testid: 'profile-tools',
      },
      {
        kind: 'pair',
        items: [
          {
            kind: 'number',
            key: 'years',
            label: 'totalYears',
            unit: 'years',
            testid: 'profile-years',
          },
        ],
      },
      { kind: 'industries', info: 'industries' },
      { kind: 'languages' },
      {
        kind: 'pair',
        items: [
          {
            kind: 'chips',
            key: 'degrees',
            label: 'degrees',
            placeholder: 'degreesPlaceholder',
            more: 'degreesMore',
            lines: true,
            asked: 'degree',
            testid: 'profile-degrees',
          },
          {
            kind: 'chips',
            key: 'certificates',
            label: 'certificates',
            placeholder: 'certificatesPlaceholder',
            more: 'certificatesMore',
            lines: true,
            asked: 'certificate',
            testid: 'profile-certificates',
          },
        ],
      },
    ],
  },
  {
    id: 'exclusions',
    rows: [
      {
        kind: 'chips',
        key: 'exclusionWords',
        label: 'exclusionWords',
        placeholder: 'exclusionWordsPlaceholder',
        more: 'exclusionWordsMore',
        info: 'exclusionWords',
        testid: 'profile-exclusion-words',
      },
    ],
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
      return 'permanent';
    default:
      return control.kind;
  }
}

/** The fields of a line, left to right. */
export const controlsOf = (row: Row): readonly Control[] =>
  row.kind === 'pair' ? row.items : [row];

/** Every value of the form in the order of the page (the missing sentence names them so). */
export const FIELD_ORDER: readonly (keyof ProfileForm)[] = SECTIONS.flatMap((section) =>
  section.rows.flatMap(controlsOf),
).map(fieldOf);

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
