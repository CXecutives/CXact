// The preview's demo data as the engine computed them (demo/snapshot.json). A spec reads a
// score, a reason, a count or a text of the engine from here, never as a literal: a
// regenerated snapshot (an engine change) keeps it green. A spec that needs a job of some
// kind (the scripted fetch's of the high band, one with a "+" into the profile) takes it by
// the role its ad names in demo/ads.json (`expect`), which core's snapshot test holds every
// ad to, or by what its reader holds.

import { readFileSync } from 'node:fs';

import type { JobDetail, JobView, Reason, ReasonCode } from '../../../ui/src/lib/ipc/types';
import type { Snapshot } from '../snapshot';

export const DEMO = JSON.parse(
  readFileSync(new URL('../demo/snapshot.json', import.meta.url), 'utf8'),
) as Snapshot;

/** A demo ad's role once its page came: the band of its score, or its status while it is not
 *  scored. */
export type DemoRole = 'high' | 'mid' | 'low' | 'excluded' | 'unscorable';

interface DemoAd {
  portal: string;
  id: string;
  expect?: DemoRole;
  /** The ad comes with the preview's scripted fetch. */
  run?: boolean;
}

const ADS = JSON.parse(
  readFileSync(new URL('../demo/ads.json', import.meta.url), 'utf8'),
) as DemoAd[];

/** `portal:id` of a key the specs write either way (`freelancermap-2801`, `freelancermap:2801`). */
const keyOf = (key: string): string => key.replace(/^([a-z]+)-/, '$1:');

/** A demo job's list row before the scripted fetch. */
export function demoJob(key: string): JobView {
  const job = DEMO.jobs.find((j) => `${j.key.portal}:${j.key.id}` === keyOf(key));
  if (job === undefined) throw new Error(`no demo job ${key}`);
  return job;
}

/** The score of a demo job (its ring). */
export function demoScore(key: string): number {
  const match = demoJob(key).match;
  if (match === null) throw new Error(`demo job ${key} has no score`);
  return match.score;
}

/** The jobs of the scripted fetch (`portal-id`) whose ads name this role. */
export const demoRunKeys = (role: DemoRole): string[] =>
  ADS.filter((ad) => ad.run === true && ad.expect === role).map((ad) => `${ad.portal}-${ad.id}`);

/** What the scripted fetch brings by its ads' roles: the new jobs that are not excluded, and
 *  those of the high band (the counts of its end toast). */
export function demoRun(): { fresh: number; high: number } {
  const run = ADS.filter((ad) => ad.run === true);
  return {
    fresh: run.filter((ad) => ad.expect !== 'excluded').length,
    high: run.filter((ad) => ad.expect === 'high').length,
  };
}

/** A demo job's reader before the scripted fetch. */
export function demoDetail(key: string): JobDetail {
  const detail = DEMO.details[keyOf(key)];
  if (detail === undefined) throw new Error(`no reader of the demo job ${key}`);
  return detail;
}

/** The first reason of a demo job's reader of this code, or that passes the test. */
export function demoReason(
  key: string,
  test: ReasonCode | ((reason: Reason) => boolean),
): Reason | undefined {
  const pass = typeof test === 'string' ? (reason: Reason) => reason.code === test : test;
  return demoDetail(key).match?.reasons.find(pass);
}

/** The demo's requirement whose words start with these (the ad's own words). */
export const demoRequirement = (key: string, words: string): Reason | undefined =>
  demoReason(key, (reason) => reason.code === 'requirement' && reason.label.startsWith(words));

/** The verdict a reason gives the row of the Jobdetails it stands for, as the reader marks it
 *  (`data-verdict`, '' without one): a wish by its state, a limit missed or a requirement met
 *  in part in part, a check of an unclear ad unclear. */
export function demoVerdict(reason: Reason | undefined): string {
  if (reason === undefined) return '';
  if (['dayRateWish', 'remoteWish', 'regionWish'].includes(reason.code)) {
    const state = reason.params.state;
    return state === 'met' ? 'met' : state === 'near' || state === 'missed' ? 'partial' : '';
  }
  const limit = ['workload', 'duration', 'availabilityGap'].includes(reason.code);
  const verdicts: Record<Reason['kind'], string> = {
    violation: 'violated',
    partial: 'partial',
    check: limit ? 'partial' : 'unknown',
    met: 'met',
    open: '',
  };
  return verdicts[reason.kind];
}

/** The demo jobs (`portal-id`, scored, outside the Papierkorb, in the order of demo/ads.json)
 *  whose reader has at least `count` missing musts with a term of the profile: each a "+"
 *  into it. Its place is `demoJob(key).place`. */
export function demoAddable(count: number): string[] {
  const addable = (reason: Reason): boolean =>
    reason.kind === 'open' &&
    reason.weight === 'must' &&
    typeof reason.params.term === 'string' &&
    typeof reason.params.field === 'string';
  return ADS.filter((ad) => ad.run !== true && ad.expect !== undefined)
    .map((ad) => `${ad.portal}-${ad.id}`)
    .filter((key) => demoJob(key).match?.status === 'scored' && demoJob(key).place !== 'trash')
    .filter((key) => (demoDetail(key).match?.reasons.filter(addable).length ?? 0) >= count);
}
