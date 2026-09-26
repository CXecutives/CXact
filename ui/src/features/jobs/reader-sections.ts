// The reader's structure as data (Reader.svelte renders each entry by its key). Moving an entry
// moves its section or group; removing it hides it. The rows of "Konditionen" are the table of
// terms.ts, the "…" menu is the table in Reader.svelte.

import { t } from '$lib/i18n/t';
import type { ReasonKind } from '$lib/ipc/types';

/**
 * The sections, top to bottom:
 * - head: title and close, company and place, portal and time, where the job lies;
 * - match: the ring beside the band, the must count (said here only) and one quiet line;
 * - actions: "Anzeige öffnen", Favorit, the moves of the place and "…";
 * - exclusion: why the engine excludes the job, where the ad says it, and the user's word;
 * - terms: "Konditionen", only for an ad the app has read;
 * - requirements: "Anforderungen", in the groups below;
 * - ad: the note on a missing text and the ad text.
 */
export const READER_SECTIONS = [
  'head',
  'match',
  'actions',
  'exclusion',
  'terms',
  'requirements',
  'ad',
] as const;

export interface RequirementGroup {
  kind: Extract<ReasonKind, 'met' | 'partial' | 'open' | 'check'>;
  label: () => string;
}

/** The groups of "Anforderungen", in their order (no counts: the must count stands in the
 *  head). A missing must carries its way into the profile in the group "Nicht im Profil". */
export const REQUIREMENT_GROUPS: readonly RequirementGroup[] = [
  { kind: 'met', label: () => t.reader.met },
  { kind: 'partial', label: () => t.reader.partial },
  { kind: 'open', label: () => t.reader.missing },
  { kind: 'check', label: () => t.reader.check },
];
