// The preview's demo data as the engine computed them (demo/snapshot.json). A spec reads a
// score, a reason, a count or a text of the engine from here, never as a literal: a
// regenerated snapshot (an engine change) keeps it green.

import { readFileSync } from 'node:fs';

import type { JobDetail, JobView, Reason } from '../../../ui/src/lib/ipc/types';
import type { Snapshot } from '../snapshot';

export const DEMO = JSON.parse(
  readFileSync(new URL('../demo/snapshot.json', import.meta.url), 'utf8'),
) as Snapshot;

/** `portal:id` of a key the specs write either way (`freelancermap-2801`, `freelancermap:2801`). */
const keyOf = (key: string): string => key.replace(/^([a-z]+)-/, '$1:');

/** A demo job's list row before the scripted fetch. */
export function demoJob(key: string): JobView {
  const job = DEMO.jobs.find((j) => `${j.key.portal}:${j.key.id}` === keyOf(key));
  if (job === undefined) throw new Error(`no demo job ${key}`);
  return job;
}

/** A demo job's reader. */
export function demoDetail(key: string): JobDetail {
  const detail = DEMO.details[keyOf(key)];
  if (detail === undefined) throw new Error(`no demo detail ${key}`);
  return detail;
}

/** The score of a demo job (its ring). */
export function demoScore(key: string): number {
  const match = demoJob(key).match;
  if (match === null) throw new Error(`demo job ${key} has no score`);
  return match.score;
}

/** The reasons of a demo job's reader. */
export function demoReasons(key: string): Reason[] {
  return demoDetail(key).match?.reasons ?? [];
}

/** The must line of a demo job's reader, from the counts the engine found (the words of the
 *  German catalog's `reader.mustMet`): "4 von 6 Pflichtpunkten erfüllt, 2 teilweise". */
export function demoMustLine(key: string): string {
  const params = demoDetail(key).match?.summary?.params ?? {};
  const [met, total, partial] = [params.mustMet, params.mustTotal, params.mustPartial].map(Number);
  const points = total === 1 ? 'Pflichtpunkt' : 'Pflichtpunkten';
  return `${met} von ${total} ${points} erfüllt${partial! > 0 ? `, ${partial} teilweise` : ''}`;
}
