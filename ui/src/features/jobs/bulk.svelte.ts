// What can be done with all chosen jobs at once: the list header's selection bar offers the
// actions that fit every chosen job, then the star, as icons; the pane beside the list (two
// columns) names the chosen jobs and offers the same with their words, and "Details holen"
// when every one still lacks its full ad. Deleting for good asks the one question first.

import type { SelectionAction } from '$components/SelectionBar.svelte';
import { t } from '$lib/i18n/t';
import type { JobView } from '$lib/ipc/types';
import { isExcluded, jobs } from '$lib/state/jobs.svelte';
import { run } from '$lib/state/run.svelte';
import { viewport } from '$lib/state/viewport.svelte';
import { actionsFor, detailsWanted, hasStar, move, purge, toggleStar } from './actions';
import { selection } from './selection.svelte';

class Bulk {
  /** The chosen jobs as the list shows them (active first, then the excluded ones). */
  readonly chosen = $derived.by((): JobView[] => {
    const shown = jobs.shown;
    return selection.jobs([
      ...shown.filter((job) => !isExcluded(job)),
      ...shown.filter(isExcluded),
    ]);
  });

  /** Two or more chosen: the bar and the summary are up. In one column one is enough:
   *  choosing opens no job there, so the header's bar acts on it. */
  get active(): boolean {
    return this.chosen.length >= (viewport.narrow ? 1 : 2);
  }

  confirmPurge = $state(false);
  purging = $state(false);
  purgeError = $state<string | null>(null);
  readonly actions = $derived.by((): SelectionAction[] => {
    const chosen = this.chosen;
    const out: SelectionAction[] = actionsFor(chosen).map((action) => ({
      icon: action.icon,
      label: action.label,
      testid: `selection-${action.id}`,
      warns: action.id === 'purge',
      // Deleting for good waits for a run (the backend refuses meanwhile).
      disabled: action.id === 'purge' && run.active,
      disabledReason: run.busyText,
      onclick: () => {
        if (action.id === 'purge') {
          this.purgeError = null;
          this.confirmPurge = true;
          return;
        }
        const list = this.chosen;
        selection.clear();
        // One that fails says so in the list header.
        void move(list, action.id).then((failed) => (jobs.actionError = failed));
      },
    }));
    if (chosen.every((job) => hasStar(job.place))) {
      const on = chosen.some((job) => !job.pinned);
      out.push({
        icon: 'star',
        label: on ? t.selection.pin : t.reader.unpin,
        testid: 'selection-star',
        onclick: () => toggleStar(this.chosen),
      });
    }
    return out;
  });

  /** The pane's buttons: the bar's actions, then the full ads where they fit. */
  readonly paneActions = $derived.by((): SelectionAction[] => {
    const chosen = this.chosen;
    const out = [...this.actions];
    if (chosen.length > 0 && chosen.every(detailsWanted)) {
      out.push({
        icon: 'download',
        label: t.reader.fetchDetails,
        testid: 'selection-details',
        disabled: run.detailsBlocked !== null,
        disabledReason: run.detailsBlocked,
        onclick: () => void run.start({ kind: 'details', keys: this.chosen.map((job) => job.key) }),
      });
    }
    return out;
  });

  async purgeChosen(): Promise<void> {
    this.purging = true;
    this.purgeError = await purge(this.chosen);
    this.purging = false;
    if (this.purgeError === null) {
      this.confirmPurge = false;
      selection.clear();
    }
  }
}

export const bulk = new Bulk();
