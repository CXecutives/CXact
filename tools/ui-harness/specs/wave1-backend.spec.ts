// Wave 1, backend track: what the page shows of the backend's files, texts and settings,
// against the stub (which mirrors the backend's contract).

import type { Page } from '@playwright/test';
import type { ExportSummary, RunEvent } from '../../../ui/src/lib/ipc/types';
import { expect, open, test } from './fixtures';
import { T } from './helpers';

const WIN = '?platform=windows';

/** A fetch that finished as the backend reports it, with what its export says. */
function finished(files: Partial<ExportSummary>): RunEvent {
  return {
    type: 'finished',
    summary: {
      run: 42,
      kind: 'fetch',
      outcome: { kind: 'completed' },
      dryRun: false,
      startedAt: '2026-09-24T07:29:00Z',
      finishedAt: '2026-09-24T07:30:00Z',
      scan: null,
      perPortal: [],
      newJobs: { count: 0, high: 0 },
      score: null,
      export: {
        overviewXlsx: null,
        backup: null,
        error: null,
        ...files,
      },
      emptyAlerts: [],
    },
  };
}

async function finish(page: Page, files: Partial<ExportSummary>): Promise<void> {
  await page.evaluate((event) => {
    window.__harness.emit({ type: 'started', kind: 'fetch' });
    window.__harness.emit(event);
  }, finished(files));
}

test('an unreachable result folder is said as such in the run line, with a retry', async ({
  page,
}) => {
  await open(page, WIN);
  await finish(page, { error: { kind: 'io', params: { target: 'workspace' } } });
  const failed = page.getByTestId('run-problem');
  await expect(failed).toContainText(T.run.exportFailed.workspace);
  await expect(failed).not.toContainText('Textdateien');
  await expect(failed.getByTestId('run-retry')).toHaveText('Erneut versuchen');
});
