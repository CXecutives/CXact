// The shape of demo/snapshot.json: what the engine computed for the preview's demo
// (core/tests/ui_demo_snapshot.rs over demo/ads.json and demo/profile.json). The stub answers
// from it, the specs read their expectations from it (docs/CHANGING.md, "The preview's demo
// data").

import type {
  JobDetail,
  JobView,
  Language,
  OverviewStats,
  ProfileInfo,
} from '../../ui/src/lib/ipc/types';

export interface Snapshot {
  /** The fixed "now" of the demo. */
  now: string;
  /** The list rows before the scripted fetch, in the order of demo/ads.json. */
  jobs: JobView[];
  /** The reader of every job of `jobs`, by `portal:id`. */
  details: Record<string, JobDetail>;
  /** The scripted fetch's new jobs as their alert mails announce them. */
  announced: JobView[];
  /** Jobs once their page came and the engine scored them, by `portal:id`: those whose
   *  details were missing ("Details holen") and the scripted fetch's. */
  fetched: Record<string, { job: JobView; detail: JobDetail }>;
  /** The Übersicht's numbers with the profile, after it was removed, and without any job. */
  overview: OverviewStats;
  overviewWithoutProfile: OverviewStats;
  overviewEmpty: OverviewStats;
  /** The stored profile with what the engine understood of it. */
  profile: ProfileInfo;
  /** The AI prompts per language: every job's by `portal:id`, and the comparison (`top`). */
  prompts: Record<Language, Record<string, string>>;
}
