// The generating tests in one run (`npm run gen`, after `npm run regen`): with CXACT_REGEN=1
// each writes its file and passes (core/src/export/generated.rs), so after a change of a code,
// a type or the engine one run brings every generated file up to date and the next
// `cargo test --workspace` is green on its first run. Then it lists what changed; look at the
// diff and commit it with the change. The files carry `merge=regen` in .gitattributes: after a
// merge, run it again.
//
//     npm run gen

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The runs, in their order: the types first, the command map reads their folder. */
const RUNS = [
  [
    '--lib',
    '--',
    'ipc_types_are_generated_and_committed',
    'the_harness_has_the_vocabulary',
    'golden_prompt',
  ],
  [
    '--test',
    'contract',
    '--test',
    'ui_demo_snapshot',
    '--test',
    'matching_corpus',
    '--',
    'the_typescript_command_map_is_generated_and_committed',
    'the_preview_s_demo_data_come_from_the_engine',
    'golden_digest_of_all_corpus_results',
  ],
];

/** What the runs write (with the colours of `npm run regen`, `merge=regen` in .gitattributes). */
const GENERATED = [
  'ui/src/lib/ipc/types',
  'tools/ui-harness/demo/snapshot.json',
  'tools/ui-harness/demo/vocabulary.json',
  'core/tests/fixtures/prompts/job.de.md',
  'core/tests/fixtures/matching/golden_digest.txt',
];

const env = { ...process.env, CXACT_REGEN: '1' };
for (const args of RUNS) {
  const run = spawnSync('cargo', ['test', '-p', 'jobalert-core', ...args], {
    cwd: repo,
    env,
    stdio: 'inherit',
  });
  if (run.status !== 0) process.exit(run.status ?? 1);
}
const status = spawnSync('git', ['status', '--short', '--', ...GENERATED], {
  cwd: repo,
  encoding: 'utf8',
});
const changed = status.stdout.trimEnd();
console.log(changed ? `Generated files changed:\n${changed}` : 'Every generated file was current.');
