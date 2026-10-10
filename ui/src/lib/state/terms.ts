// A term the ads ask for and the field of the profile it goes into (core
// `matching::core_term`: "Kenntnisse in Anaplan" is the tool "Anaplan", "Branchenerfahrung
// Energie" the industry "Energie"), and how a term goes into a form and out of it again: the
// Profil's "Häufig verlangt" puts one into the form as an unsaved change, the reader's "+"
// into the stored profile (`addToProfile` in profile.svelte.ts).

import type { LanguageLevel, ProfileForm, TermField } from '../ipc/types';

export interface ProfileTerm {
  term: string;
  field: TermField;
  /** The level a language goes in with (`AskedTerm.level`); none: the assumed one. */
  level?: LanguageLevel | null;
}

/** The fields that are lists of words, by the key of their list in the form. */
const LISTS = {
  tool: 'tools',
  certificate: 'certificates',
  degree: 'degrees',
} as const satisfies Record<
  Exclude<TermField, 'competence' | 'industry' | 'language'>,
  keyof ProfileForm
>;

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The names of one field of the form (a competence, an industry, a language). */
function namesIn(form: ProfileForm, field: TermField): string[] {
  if (field === 'competence') return form.competences.map((row) => row.name);
  if (field === 'industry') return form.industries.map((row) => row.name);
  if (field === 'language') return form.languages.map((row) => row.language);
  return form[LISTS[field]];
}

/** Every term the form names, in any field: a term of the ads it names is none the profile
 *  lacks (core `view::named_terms`). */
export function termsOf(form: ProfileForm): string[] {
  const fields: TermField[] = [
    'competence',
    'language',
    'tool',
    'industry',
    'certificate',
    'degree',
  ];
  return fields.flatMap((field) => namesIn(form, field));
}

/** The level of a language without one of its own (core matching's assumed level). */
const ASSUMED_LEVEL = 'B2';

/** Puts the term at the end of its field of `form` (a competence row, an industry without a
 *  star, a language at its level, an entry of a list); `false` when the field names it
 *  already. */
export function putTerm(form: ProfileForm, { term, field, level }: ProfileTerm): boolean {
  const text = term.trim();
  if (text === '' || namesIn(form, field).some((name) => same(name, text))) return false;
  if (field === 'competence') {
    form.competences = [...form.competences, { name: text, years: null, focus: false }];
  } else if (field === 'industry') {
    form.industries = [...form.industries, { name: text, preferred: false }];
  } else if (field === 'language') {
    form.languages = [...form.languages, { language: text, level: level ?? ASSUMED_LEVEL }];
  } else {
    form[LISTS[field]] = [...form[LISTS[field]], text];
  }
  return true;
}

/** Takes the term out of its field of `form` again (the row or the entry of its name). */
export function takeTerm(form: ProfileForm, { term, field }: ProfileTerm): void {
  const other = (name: string): boolean => !same(name, term);
  if (field === 'competence') {
    form.competences = form.competences.filter((row) => other(row.name));
  } else if (field === 'industry') {
    form.industries = form.industries.filter((row) => other(row.name));
  } else if (field === 'language') {
    form.languages = form.languages.filter((row) => other(row.language));
  } else {
    form[LISTS[field]] = form[LISTS[field]].filter(other);
  }
}
