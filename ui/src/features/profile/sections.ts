// The Profil form as data: the rows of the page in three sections (Was du suchst, Was du
// mitbringst, Was nicht passt; user decision 2026-10-03, variant 3, in rows since design
// round 3), and the two short forms of the setup (after the CV, and by hand). ProfileEditor
// renders these tables and nothing else, so adding, moving or removing a field is one entry
// here (docs/CHANGING.md "Add a profile field"). A row names the value of the form it edits,
// its control, its words by their key in the catalog (`t.profile.field`) and, at the few
// places docs/PLAN.md names, its info symbol (`t.profile.info`). Controls with more to them
// than a field (the day rate, the competences, the industries, the languages, the countries,
// the day) are components the table names by their kind.

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
/** A choice of a few, one segmented control each. */
export type ChoiceKey = 'workMode' | 'workload' | 'minMonths';

/** A row of the form. `shown` keeps it out of the form while the values it depends on say
 *  it has nothing to do; `advice` is a quiet line while the values contradict each other. */
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
  | { kind: 'switch'; key: 'permanent' | 'temporary'; label: Word; text?: Word; info?: Info }
  | { kind: 'rate'; info: Info }
  | { kind: 'choice'; key: ChoiceKey; label: Word; info?: Info; testid: string }
  | { kind: 'countries'; info: Info }
  | { kind: 'available' }
  | { kind: 'competences'; info: Info }
  /** The competences as names only, one chip each (the setup's short form). */
  | { kind: 'competenceNames'; info: Info }
  | { kind: 'industries'; info: Info }
  | { kind: 'languages' };

export type SectionId = keyof Catalog['profile']['section'];

export interface Section {
  id: SectionId;
  rows: readonly Control[];
}

const ROLES: Control = {
  kind: 'chips',
  key: 'roles',
  label: 'roles',
  placeholder: 'rolesPlaceholder',
  more: 'rolesMore',
  info: 'roles',
  suggest: 'roles',
  testid: 'profile-roles',
};
const PERMANENT: Control = {
  kind: 'switch',
  key: 'permanent',
  label: 'permanent',
  text: 'contractsText',
  info: 'contracts',
};
const TEMPORARY: Control = { kind: 'switch', key: 'temporary', label: 'temporary' };
const RATE: Control = { kind: 'rate', info: 'dayRate' };
const WORK_MODE: Control = {
  kind: 'choice',
  key: 'workMode',
  label: 'workMode',
  info: 'workMode',
  testid: 'profile-work-mode',
};
const COUNTRIES: Control = { kind: 'countries', info: 'countries' };
const LANGUAGES: Control = { kind: 'languages' };

export const SECTIONS: readonly Section[] = [
  {
    id: 'search',
    rows: [
      ROLES,
      PERMANENT,
      TEMPORARY,
      {
        // The salary counts for Festanstellung and Zeitarbeit only.
        kind: 'number',
        key: 'minSalary',
        label: 'minSalary',
        unit: 'euro',
        shown: (form) => form.permanent || form.temporary,
        testid: 'profile-min-salary',
      },
      RATE,
      WORK_MODE,
      COUNTRIES,
      {
        kind: 'chips',
        key: 'regions',
        label: 'regions',
        placeholder: 'regionsPlaceholder',
        more: 'regionsMore',
        suggest: 'regions',
        testid: 'profile-regions',
      },
      { kind: 'available' },
      { kind: 'choice', key: 'workload', label: 'workload', testid: 'profile-workload' },
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
        kind: 'number',
        key: 'years',
        label: 'totalYears',
        unit: 'years',
        testid: 'profile-years',
      },
      { kind: 'industries', info: 'industries' },
      LANGUAGES,
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

/** The setup's short forms: after the CV ("Fast fertig": what only the user can say) and by
 *  hand ("Dein Profil": the most important). A required field missing when the form opens
 *  shows as well, in the order of the page (`withMissing`). */
export const SETUP_FORMS = {
  review: [ROLES, PERMANENT, TEMPORARY, RATE, WORK_MODE, COUNTRIES, LANGUAGES],
  self: [ROLES, { kind: 'competenceNames', info: 'competences' }, LANGUAGES, PERMANENT, TEMPORARY],
} as const satisfies Record<string, readonly Control[]>;
export type SetupForm = keyof typeof SETUP_FORMS;

/** The values of the form a control edits (the fields `ProfileInfo.missing` names). */
export function fieldsOf(control: Control): (keyof ProfileForm)[] {
  switch (control.kind) {
    case 'number':
    case 'chips':
    case 'switch':
    case 'choice':
      return [control.key];
    case 'rate':
      return ['dayRateWish', 'dayRateMin'];
    case 'competenceNames':
      return ['competences'];
    default:
      return [control.kind];
  }
}

/** Every row of the page, in its order. */
const PAGE_ROWS: readonly Control[] = SECTIONS.flatMap((section) => section.rows);

/** Every value of the form in the order of the page (the missing line names them so). */
export const FIELD_ORDER: readonly (keyof ProfileForm)[] = PAGE_ROWS.flatMap(fieldsOf);

/** A short form of the setup with the required fields missing at its start that it does not
 *  hold, each after the last row that comes before it on the page (a field that stood empty
 *  keeps its row once filled: the caller asks once). */
export function withMissing(form: SetupForm, missing: readonly string[]): Control[] {
  const rows: Control[] = [...SETUP_FORMS[form]];
  const held = new Set(rows.flatMap(fieldsOf));
  for (const field of missing) {
    if (held.has(field as keyof ProfileForm)) continue;
    const row = PAGE_ROWS.find((each) => fieldsOf(each).includes(field as keyof ProfileForm));
    if (row === undefined) continue;
    // After the last row that comes before it on the page.
    const at = PAGE_ROWS.indexOf(row);
    const after = rows.findLastIndex((each) => PAGE_ROWS.indexOf(each) < at);
    // The short form takes the competences as names only.
    rows.splice(
      after + 1,
      0,
      row.kind === 'competences' ? { kind: 'competenceNames', info: row.info } : row,
    );
    held.add(field as keyof ProfileForm);
  }
  return rows;
}

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
