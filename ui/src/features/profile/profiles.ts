// The names of the profiles of the work folder (`AppState.profiles`, core's profile::set):
// the name the user gave, else the profile's role, else its number ("Profil 2").

import { t } from '$lib/i18n/t';
import type { ProfileEntry } from '$lib/ipc/types';

/** The name a profile goes by without one of its own. */
export function defaultName(entry: ProfileEntry): string {
  return entry.role ?? t.profile.numbered(entry.id);
}

/** The name the switcher shows. */
export function profileName(entry: ProfileEntry): string {
  return entry.name ?? defaultName(entry);
}

/** The name of the active profile among `entries`, as the title shows it (none: no profile). */
export function activeName(entries: readonly ProfileEntry[] | undefined): string | null {
  const entry = entries?.find((each) => each.active) ?? null;
  return entry === null ? null : profileName(entry);
}
