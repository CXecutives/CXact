// The Profil form as data: its sections in their order, each with its lines of fields.
// ProfileEditor.svelte renders this table and nothing else, so adding, moving or removing a
// field or a section is one entry here (docs/CHANGING.md "Add a profile criterion"). A field
// names the value of the form it edits (a criterion by its key: its limit and unit come from
// core, `types/profile.ts`), its control, and its words by their key in the catalog
// (`t.profile.field`), so they follow the language. Controls with more to them than a field
// (the competences table, the languages, the countries, the day, the workload, the remote
// choice, the switches) are components the table names by their kind.
//
// Every section has its heading under its id in the catalog (`t.profile.section`) and the
// testid `section-{id}`; the two whose effect is easy to get wrong (Bedingungen, Wünsche) say
// it in one sentence (`t.profile.sectionHint`). Order (user decision 2026-09-26): the one
// block the profile needs first, the conditions and the rules of permanent roles next to the
// wishes.

import type { Catalog } from '$lib/i18n/de';
import type { ProfileForm, UnreadableField } from '$lib/ipc/types';
import {
  NUMBER_CRITERIA,
  WORD_CRITERIA,
  type NumberCriterion,
  type WordCriterion,
} from '$lib/ipc/types/profile';

type Words = Catalog['profile']['field'];
/** A text of the form in the catalog (`t.profile.field`), by its key. */
export type Word = { [K in keyof Words]: Words[K] extends string ? K : never }[keyof Words];
/** The unit beside a number (`t.profile.unit`). */
export type Unit = keyof Catalog['profile']['unit'];

/** A number of the form: a criterion, or the experience and the wished day rate. */
export type NumberKey = NumberCriterion | 'years' | 'wishDayRate';
/** A list of words of the form. */
export type ListKey =
  | WordCriterion
  | 'strengths'
  | 'keywords'
  | 'degrees'
  | 'industries'
  | 'tools'
  | 'certificates'
  | 'roles'
  | 'regions'
  | 'wishIndustries';
export type SwitchKey = 'remoteOutside' | 'noAnue' | 'noPermanent';

/** A field of the form. `hint` is its quiet line; `advice` a quiet line in its place while
 *  the values of the form say something about it; `off` holds a field back (with its
 *  advice as the reason) while it has nothing to do. */
export type Control =
  | { kind: 'text'; key: 'name' | 'title'; label: Word; placeholder: Word; testid: string }
  | {
      kind: 'number';
      key: NumberKey;
      label: Word;
      hint?: Word;
      /** The unit of a number that is no criterion (a criterion's comes from core). */
      unit?: Unit;
      advice?: (form: ProfileForm) => Word | null;
      off?: (form: ProfileForm) => boolean;
      testid: string;
    }
  | {
      kind: 'chips';
      key: ListKey;
      label: Word;
      hint?: Word;
      placeholder: Word;
      /** Entries are sentences: only a line break splits a pasted list. */
      lines?: true;
      /** The engine's words it suggests while typing (vocabulary.svelte.ts). */
      suggest?: 'skills' | 'industries';
      testid: string;
    }
  | {
      kind: 'switch';
      key: SwitchKey;
      label: Word;
      hint?: Word;
      /** Why the switch has nothing to do now (disabled), or null. */
      off?: (form: ProfileForm) => Word | null;
      testid: string;
    }
  | { kind: 'competences' }
  | { kind: 'languages' }
  | { kind: 'countries' }
  | { kind: 'available' }
  | { kind: 'workload' }
  | { kind: 'remote' };

/** A line of a section: one field, two side by side (one under the other when narrow), or
 *  the switches of a group (one hairline list). */
export type Line =
  | Control
  | { kind: 'pair'; fields: readonly [Control, Control] }
  | { kind: 'switches'; fields: readonly Extract<Control, { kind: 'switch' }>[] };

export type SectionId =
  'person' | 'competences' | 'experience' | 'languages' | 'criteria' | 'permanent' | 'wishes';

export interface Section {
  id: SectionId;
  /** The one block the profile needs: its "Noch leer" is amber. */
  required?: true;
  /** The section waits while the form says so (the rules of permanent roles while those are
   *  excluded). */
  hidden?: (form: ProfileForm) => boolean;
  lines: readonly Line[];
}

const pair = (a: Control, b: Control): Line => ({ kind: 'pair', fields: [a, b] });

export const SECTIONS: readonly Section[] = [
  {
    id: 'person',
    lines: [
      pair(
        {
          kind: 'text',
          key: 'name',
          label: 'name',
          placeholder: 'namePlaceholder',
          testid: 'profile-name-field',
        },
        {
          kind: 'text',
          key: 'title',
          label: 'title',
          placeholder: 'titlePlaceholder',
          testid: 'profile-title',
        },
      ),
    ],
  },
  {
    id: 'competences',
    required: true,
    lines: [
      { kind: 'competences' },
      {
        kind: 'chips',
        key: 'strengths',
        label: 'strengths',
        placeholder: 'strengthsPlaceholder',
        lines: true,
        testid: 'profile-strengths',
      },
      {
        kind: 'chips',
        key: 'keywords',
        label: 'keywords',
        placeholder: 'keywordsPlaceholder',
        suggest: 'skills',
        testid: 'profile-keywords',
      },
    ],
  },
  {
    id: 'experience',
    lines: [
      {
        kind: 'number',
        key: 'years',
        label: 'totalYears',
        unit: 'years',
        testid: 'profile-years',
      },
      {
        kind: 'chips',
        key: 'degrees',
        label: 'degrees',
        placeholder: 'degreesPlaceholder',
        lines: true,
        testid: 'profile-degrees',
      },
      {
        kind: 'chips',
        key: 'certificates',
        label: 'certificates',
        placeholder: 'certificatesPlaceholder',
        lines: true,
        testid: 'profile-certificates',
      },
      {
        kind: 'chips',
        key: 'tools',
        label: 'tools',
        placeholder: 'toolsPlaceholder',
        suggest: 'skills',
        testid: 'profile-tools',
      },
      {
        kind: 'chips',
        key: 'industries',
        label: 'industries',
        placeholder: 'industriesPlaceholder',
        suggest: 'industries',
        testid: 'profile-industries',
      },
    ],
  },
  { id: 'languages', lines: [{ kind: 'languages' }] },
  {
    // What excludes a job, from when she is free, the days a week and the duration, the
    // words that exclude, the countries and the switches.
    id: 'criteria',
    lines: [
      pair(
        { kind: 'number', key: 'minDayRate', label: 'minDayRate', testid: 'profile-min-rate' },
        {
          kind: 'number',
          key: 'targetYears',
          label: 'targetYears',
          advice: (form) =>
            form.criteria.targetYears !== null &&
            form.years !== null &&
            form.criteria.targetYears > form.years
              ? 'aboveExperience'
              : null,
          testid: 'profile-target-years',
        },
      ),
      { kind: 'available' },
      pair(
        { kind: 'workload' },
        {
          kind: 'number',
          key: 'minMonths',
          label: 'minMonths',
          testid: 'profile-min-months',
        },
      ),
      {
        kind: 'chips',
        key: 'exclusionWords',
        label: 'exclusionWords',
        placeholder: 'exclusionWordsPlaceholder',
        testid: 'profile-exclusion-words',
      },
      { kind: 'countries' },
      {
        kind: 'switches',
        fields: [
          // On excludes: the file's "allowed" is the switch turned off.
          {
            kind: 'switch',
            key: 'remoteOutside',
            label: 'remoteOutside',
            off: (form) => (form.criteria.countries.length === 0 ? 'remoteOutsideOff' : null),
            testid: 'profile-remote-outside',
          },
          { kind: 'switch', key: 'noAnue', label: 'noAnue', testid: 'profile-no-anue' },
          {
            kind: 'switch',
            key: 'noPermanent',
            label: 'noPermanent',
            testid: 'profile-no-permanent',
          },
        ],
      },
    ],
  },
  {
    // The rules of permanent roles: they wait while those are excluded.
    id: 'permanent',
    hidden: (form) => form.criteria.noPermanent,
    lines: [
      {
        kind: 'chips',
        key: 'permanentPlaces',
        label: 'places',
        placeholder: 'placesPlaceholder',
        testid: 'profile-places',
      },
      pair(
        {
          kind: 'number',
          key: 'minSalary',
          label: 'minSalary',
          testid: 'profile-min-salary',
        },
        {
          // The share counts only outside the places: without them it waits.
          kind: 'number',
          key: 'permanentRemoteMin',
          label: 'remoteMin',
          hint: 'remoteMinHint',
          advice: (form) => (form.criteria.permanentPlaces.length === 0 ? 'placesFirst' : null),
          off: (form) =>
            form.criteria.permanentPlaces.length === 0 && form.criteria.permanentRemoteMin === null,
          testid: 'profile-remote-min',
        },
      ),
    ],
  },
  {
    id: 'wishes',
    lines: [
      {
        kind: 'chips',
        key: 'roles',
        label: 'roles',
        placeholder: 'rolesPlaceholder',
        testid: 'profile-roles',
      },
      {
        kind: 'number',
        key: 'wishDayRate',
        label: 'wishRate',
        unit: 'euro',
        advice: (form) =>
          form.wishes.dayRate !== null &&
          form.criteria.minDayRate !== null &&
          form.wishes.dayRate < form.criteria.minDayRate
            ? 'belowMinRate'
            : null,
        testid: 'profile-wish-rate',
      },
      { kind: 'remote' },
      {
        kind: 'chips',
        key: 'regions',
        label: 'regions',
        placeholder: 'regionsPlaceholder',
        testid: 'profile-regions',
      },
      {
        kind: 'chips',
        key: 'wishIndustries',
        label: 'wishIndustries',
        placeholder: 'wishIndustriesPlaceholder',
        suggest: 'industries',
        testid: 'profile-wish-industries',
      },
    ],
  },
];

// ------------------------------------------------------------------ the values of the form

/** Values of the wishes, by the key the form's fields use for them. */
const WISHES = {
  wishDayRate: 'dayRate',
  regions: 'regions',
  wishIndustries: 'industries',
} as const;

/** The object that holds a value and its key there: a criterion (core's description) in
 *  `criteria`, a wish in `wishes`, the rest in the form itself. */
function holder(form: ProfileForm, key: string): [Record<string, unknown>, string] {
  if (key in WISHES) {
    return [form.wishes as Record<string, unknown>, WISHES[key as keyof typeof WISHES]];
  }
  if (key in NUMBER_CRITERIA || key in WORD_CRITERIA) {
    return [form.criteria as unknown as Record<string, unknown>, key];
  }
  return [form as unknown as Record<string, unknown>, key];
}

export function numberOf(form: ProfileForm, key: NumberKey): number | null {
  const [object, name] = holder(form, key);
  return (object[name] as number | null | undefined) ?? null;
}

export function setNumber(form: ProfileForm, key: NumberKey, value: number | null): void {
  const [object, name] = holder(form, key);
  object[name] = value;
}

export function listOf(form: ProfileForm, key: ListKey): string[] {
  const [object, name] = holder(form, key);
  return (object[name] as string[] | undefined) ?? [];
}

export function setList(form: ProfileForm, key: ListKey, value: string[]): void {
  const [object, name] = holder(form, key);
  object[name] = value;
}

/** A field's value as text, to see when it changes (a refused value stays marked until
 *  then): a wish, a criterion, or a value of the form itself. */
export function valueText(form: ProfileForm, field: string): string {
  if (field === 'remote') return JSON.stringify(form.wishes.remote);
  const key = field in WISHES ? WISHES[field as keyof typeof WISHES] : field;
  const object: Record<string, unknown> =
    field in WISHES
      ? (form.wishes as Record<string, unknown>)
      : field in form.criteria
        ? (form.criteria as unknown as Record<string, unknown>)
        : (form as unknown as Record<string, unknown>);
  return JSON.stringify(object[key] ?? null);
}

/** The unit of a number: a criterion's from core, else the table's. */
export function unitOf(control: Extract<Control, { kind: 'number' }>): Unit | null {
  return control.key in NUMBER_CRITERIA
    ? NUMBER_CRITERIA[control.key as NumberCriterion].unit
    : (control.unit ?? null);
}

// ------------------------------------------------------------------ what a section holds

/** Every field of some lines, in order (the fields of pairs and switches too). */
export function controlsOf(lines: readonly Line[]): Control[] {
  return lines.flatMap((line): Control[] =>
    line.kind === 'pair' || line.kind === 'switches' ? [...line.fields] : [line],
  );
}

/** The value of the file behind a switch (both contract types are one key of the file). */
export const switchField = (key: SwitchKey): UnreadableField =>
  key === 'remoteOutside' ? 'remoteOutside' : 'contracts';

/** The fields a value that does not read (or a refused one) can name for a control. */
export function fieldsOf(control: Control): string[] {
  switch (control.kind) {
    case 'text':
    case 'number':
    case 'chips':
      return [control.key];
    case 'switch':
      return [switchField(control.key)];
    case 'competences':
      return ['competences', 'focus'];
    case 'languages':
      return ['languages'];
    case 'countries':
      return ['countries'];
    case 'available':
      return ['available'];
    case 'workload':
      return ['workloadMinDays', 'workloadMaxDays'];
    case 'remote':
      return ['remote'];
  }
}

const noRows = (rows: readonly { name?: string; language?: string }[]): boolean =>
  rows.every((row) => (row.name ?? row.language ?? '').trim() === '');

/** The control holds nothing (for "Noch leer"); the remote switch is set either way. */
export function blank(form: ProfileForm, control: Control): boolean {
  const c = form.criteria;
  switch (control.kind) {
    case 'text':
      return form[control.key].trim() === '';
    case 'number':
      return numberOf(form, control.key) === null;
    case 'chips':
      return listOf(form, control.key).length === 0;
    case 'switch':
      return control.key === 'remoteOutside' || !c[control.key];
    case 'competences':
      return noRows(form.competences);
    case 'languages':
      return noRows(form.languages);
    case 'countries':
      return c.countries.length === 0;
    case 'available':
      return c.available.kind === 'unset';
    case 'workload':
      return c.workloadMinDays === null && c.workloadMaxDays === null;
    case 'remote':
      return form.wishes.remote === null;
  }
}
