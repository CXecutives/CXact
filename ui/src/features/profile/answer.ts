// What an AI's answer to the CV prompt brings into the form, said in the CV dialog before
// "Übernehmen": for an update what `updated` adds to the stored profile (it fills gaps and
// adds, it never overwrites), for a new profile what the answer holds.

import type { AnswerAdds } from '$lib/i18n/de';
import type { ProfileCriteria, ProfileForm } from '$lib/ipc/types';
import { cleanList, normalized } from '$lib/state/profile.svelte';

const key = (text: string): string => text.trim().toLowerCase();

/** The entries of `after` that `before` does not name. */
function fresh(before: readonly string[], after: readonly string[]): number {
  const known = new Set(before.map(key));
  return cleanList(after).filter((item) => !known.has(key(item))).length;
}

/** A value that was empty and is set now. */
const filled = (before: unknown, after: unknown): number =>
  (before === null || before === '') && after !== null && after !== '' ? 1 : 0;

export function answerAdds(before: ProfileForm, after: ProfileForm): AnswerAdds {
  const b = normalized(before);
  const a = normalized(after);
  const own = (name: string) => b.competences.find((row) => key(row.name) === key(name));
  let other =
    fresh(b.keywords, a.keywords) +
    fresh(b.strengths, a.strengths) +
    fresh(b.roles, a.roles) +
    fresh(b.focus, a.focus) +
    fresh(b.wishes.regions, a.wishes.regions) +
    fresh(b.wishes.industries, a.wishes.industries) +
    filled(b.name, a.name) +
    filled(b.title, a.title) +
    filled(b.wishes.dayRate, a.wishes.dayRate) +
    filled(b.wishes.remote, a.wishes.remote) +
    (a.years !== b.years ? 1 : 0);
  // A stored competence with more synonyms or more years.
  for (const row of a.competences) {
    const stored = own(row.name);
    if (stored === undefined) continue;
    other += fresh(stored.aliases, row.aliases) + (row.years !== stored.years ? 1 : 0);
  }
  // A stored language with a level now.
  for (const row of a.languages) {
    const stored = b.languages.find((each) => key(each.language) === key(row.language));
    if (stored !== undefined) other += filled(stored.level, row.level);
  }
  const criteria = Object.keys(a.criteria) as (keyof ProfileCriteria)[];
  other += criteria.filter(
    (name) => JSON.stringify(a.criteria[name]) !== JSON.stringify(b.criteria[name]),
  ).length;
  return {
    competences: fresh(
      b.competences.map((row) => row.name),
      a.competences.map((row) => row.name),
    ),
    tools: fresh(b.tools, a.tools),
    certificates: fresh(b.certificates, a.certificates),
    languages: fresh(
      b.languages.map((row) => row.language),
      a.languages.map((row) => row.language),
    ),
    industries: fresh(b.industries, a.industries),
    degrees: fresh(b.degrees, a.degrees),
    other,
  };
}
