// The Profil form as data: three sections on one page (user decision 2026-10-03, variant 3),
// each with its lines of fields. ProfileEditor.svelte renders this table and nothing else, so
// adding, moving or removing a field is one entry here (docs/CHANGING.md "Add a profile
// field"). A field names the value of the form it edits, its control, its words by their key
// in the catalog (`t.profile.field`) and, at the few places docs/PLAN.md names, its info
// symbol (`t.profile.info`). Controls with more to them than a field (the contract types, the
// competences, the industries, the languages, the countries, the day) are components the
// table names by their kind. The order of the sections is the order of the jump links.

import type { Catalog } from '$lib/i18n/de';
import type { ProfileForm, TermField } from '$lib/ipc/types';

type Words = Catalog['profile']['field'];
/** A text of the form in the catalog (`t.profile.field`), by its key. */
export type Word = { [K in keyof Words]: Words[K] extends string ? K : never }[keyof Words];
/** The unit beside a number (`t.profile.unit`). */
export type Unit = keyof Catalog['profile']['unit'];
/** An info symbol's sentence (`t.profile.info`). */
export type Info = keyof Catalog['profile']['info'];

/** A number of the form. */
export type NumberKey = 'dayRateWish' | 'dayRateMin' | 'minSalary' | 'years';
/** A list of words of the form. */
export type ListKey = 'roles' | 'regions' | 'tools' | 'degrees' | 'certificates' | 'exclusionWords';
/** The words a chip field suggests while typing (vocabulary.svelte.ts). */
export type Suggest = 'roles' | 'skills' | 'industries' | 'regions';

/** A field of the form. `shown` keeps it out of the form while the values it depends on say
 *  it has nothing to do; `advice` is a quiet line while the values contradict each other. */
export type Control =
  | {
      kind: 'number';
      key: NumberKey;
      label: Word;
      unit: Unit;
      info?: Info;
      advice?: (form: ProfileForm) => Word | null;
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
  | { kind: 'segments'; key: 'workMode'; label: Word; info?: Info; testid: string }
  | { kind: 'select'; key: 'workload' | 'minMonths'; label: Word; testid: string }
  | { kind: 'contracts'; info: Info }
  | { kind: 'countries'; info: Info }
  | { kind: 'available' }
  | { kind: 'competences'; info: Info }
  | { kind: 'industries'; info: Info }
  | { kind: 'languages' };

/** A line of a section: one field, or two side by side (one under the other when narrow). */
export type Line = Control | { kind: 'pair'; fields: readonly [Control, Control] };

export type SectionId = keyof Catalog['profile']['section'];

export interface Section {
  id: SectionId;
  lines: readonly Line[];
}

const pair = (a: Control, b: Control): Line => ({ kind: 'pair', fields: [a, b] });

export const SECTIONS: readonly Section[] = [
  {
    id: 'search',
    lines: [
      {
        kind: 'chips',
        key: 'roles',
        label: 'roles',
        placeholder: 'rolesPlaceholder',
        info: 'roles',
        suggest: 'roles',
        testid: 'profile-roles',
      },
      { kind: 'contracts', info: 'contracts' },
      pair(
        {
          kind: 'number',
          key: 'dayRateWish',
          label: 'dayRateWish',
          unit: 'euro',
          info: 'dayRate',
          advice: (form) =>
            form.dayRateWish !== null &&
            form.dayRateMin !== null &&
            form.dayRateWish < form.dayRateMin
              ? 'belowMinRate'
              : null,
          testid: 'profile-wish-rate',
        },
        {
          kind: 'number',
          key: 'dayRateMin',
          label: 'dayRateMin',
          unit: 'euro',
          testid: 'profile-min-rate',
        },
      ),
      {
        // The salary counts for Festanstellung and Zeitarbeit only.
        kind: 'number',
        key: 'minSalary',
        label: 'minSalary',
        unit: 'euro',
        shown: (form) => form.permanent || form.temporary,
        testid: 'profile-min-salary',
      },
      {
        kind: 'segments',
        key: 'workMode',
        label: 'workMode',
        info: 'workMode',
        testid: 'profile-work-mode',
      },
      pair(
        { kind: 'countries', info: 'countries' },
        {
          kind: 'chips',
          key: 'regions',
          label: 'regions',
          placeholder: 'regionsPlaceholder',
          suggest: 'regions',
          testid: 'profile-regions',
        },
      ),
      { kind: 'available' },
      pair(
        { kind: 'select', key: 'workload', label: 'workload', testid: 'profile-workload' },
        { kind: 'select', key: 'minMonths', label: 'minMonths', testid: 'profile-min-months' },
      ),
    ],
  },
  {
    id: 'skills',
    lines: [
      { kind: 'competences', info: 'competences' },
      {
        kind: 'chips',
        key: 'tools',
        label: 'tools',
        placeholder: 'toolsPlaceholder',
        suggest: 'skills',
        asked: 'tool',
        testid: 'profile-tools',
      },
      {
        kind: 'number',
        key: 'years',
        label: 'totalYears',
        unit: 'years',
        testid: 'profile-years',
      },
      { kind: 'industries', info: 'industries' },
      { kind: 'languages' },
      pair(
        {
          kind: 'chips',
          key: 'degrees',
          label: 'degrees',
          placeholder: 'degreesPlaceholder',
          lines: true,
          asked: 'degree',
          testid: 'profile-degrees',
        },
        {
          kind: 'chips',
          key: 'certificates',
          label: 'certificates',
          placeholder: 'certificatesPlaceholder',
          lines: true,
          asked: 'certificate',
          testid: 'profile-certificates',
        },
      ),
    ],
  },
  {
    id: 'exclusions',
    lines: [
      {
        kind: 'chips',
        key: 'exclusionWords',
        label: 'exclusionWords',
        placeholder: 'exclusionWordsPlaceholder',
        info: 'exclusionWords',
        testid: 'profile-exclusion-words',
      },
    ],
  },
];

/** The values of the form a control edits (the fields `ProfileInfo.missing` and
 *  `aiFilled` name). */
export function fieldsOf(control: Control): (keyof ProfileForm)[] {
  switch (control.kind) {
    case 'number':
    case 'chips':
    case 'segments':
    case 'select':
      return [control.key];
    case 'contracts':
      return ['permanent', 'temporary'];
    default:
      return [control.kind];
  }
}

/** Every field of some lines, in order (the fields of pairs too). */
export function controlsOf(lines: readonly Line[]): Control[] {
  return lines.flatMap((line): Control[] => (line.kind === 'pair' ? [...line.fields] : [line]));
}

/** Every value of the form in the order of the page (for "Zum ersten"). */
export const FIELD_ORDER: readonly (keyof ProfileForm)[] = SECTIONS.flatMap((section) =>
  controlsOf(section.lines).flatMap(fieldsOf),
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
