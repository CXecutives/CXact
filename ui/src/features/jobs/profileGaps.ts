// What keeps the profile from being usable, as the Jobs view says it (decision 3,
// 2026-10-24): "Jobs suchen" names the required fields still empty in its reason ("Ergänze
// erst Länder und Sprachen im Profil."), and the list's state box leads to the first of them
// ("Profil ergänzen": the Profil opens with that field in view, `navigation.section`, which
// the Profil reads once like Einstellungen its group). The fields are core's
// `missing_required` (ProfileInfo.missing), named as the Profil labels them.

import { t } from '$lib/i18n/t';
import { app } from '$lib/state/app.svelte';
import { navigation } from '$lib/state/navigation.svelte';
import { run } from '$lib/state/run.svelte';

export interface ProfileGaps {
  /** Why "Jobs suchen" waits for the profile (null: it does not). */
  reason: string | null;
  /** The first required field still empty (null: none, or no profile to fill). */
  first: string | null;
}

/** The label of a field of the Profil. */
function fieldName(field: string): string {
  const name = (t.profile.field as Record<string, unknown>)[field];
  return typeof name === 'string' ? name : field;
}

/** What the stored profile lacks now. */
export function profileGaps(): ProfileGaps {
  const profile = app.state?.profile ?? null;
  if (profile === null || profile.parseError !== null) {
    return { reason: t.toolbar.needsProfile, first: null };
  }
  if (profile.missing.length === 0) return { reason: null, first: null };
  return {
    reason: t.toolbar.needsFields(profile.missing.map(fieldName)),
    first: profile.missing[0] ?? null,
  };
}

/** Why "Jobs suchen" waits (the list's head, the empty list): a run, a profile that lacks
 *  something (named), nothing to read; null when it can start. */
export function fetchBlocked(): string | null {
  return !run.active && !app.hasProfile ? profileGaps().reason : run.fetchBlocked;
}

/** The Profil, with its first required field that is still empty in view. */
export function completeProfile(): void {
  const first = profileGaps().first;
  navigation.go('profile', false, () => (navigation.section = first));
}
