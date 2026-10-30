// A portal's switches and its sign-in, one way for its row in Einstellungen (PortalRow) and
// for a job whose portal shows only a preview without a sign-in (the reader's "Anmelden",
// which signs in right there). A switch moves at once (the state is patched before the
// save). Signing in opens the sign-in window (unless a sign-in is stored), and once signed in
// the fetch uses it; signing out ends both. The dry run touches no portal and a run holds the
// sign-in (`signInLocked`), except the one a search is waiting for; the backend refuses the
// others the same way.

import { t } from '../i18n/t';
import { invoke } from '../ipc/api';
import type { Portal, PortalState } from '../ipc/types';
import { app } from './app.svelte';
import { run } from './run.svelte';

export type PortalSwitches = Partial<Pick<PortalState, 'enabled' | 'loginEnabled'>>;

/** Only the answer to the latest save may replace the state (quick double flips). */
let saves = 0;

/** Saves switches of a portal; the state follows at once. A failure loads the state again
 *  and throws. */
export async function savePortal(portal: Portal, patch: PortalSwitches): Promise<void> {
  const save = ++saves;
  const item = app.state?.portals.find((p) => p.portal === portal);
  if (item) Object.assign(item, patch);
  try {
    const next = await invoke('save_settings', {
      patch: {
        portals: [
          { portal, enabled: patch.enabled ?? null, loginEnabled: patch.loginEnabled ?? null },
        ],
      },
    });
    if (save === saves) app.set(next);
  } catch (failure) {
    void app.load();
    throw failure;
  }
}

/** Anmelden (`on`) or Abmelden; a failure throws. */
export async function portalSession(portal: PortalState, on: boolean): Promise<void> {
  const done =
    on && portal.signedIn === true
      ? true
      : await invoke(on ? 'portal_login' : 'portal_logout', { portal: portal.portal });
  if (done && portal.loginEnabled !== on) await savePortal(portal.portal, { loginEnabled: on });
  await app.load();
}

/** Why a sign-in or a sign-out of `portal` waits now, or null. A search that waits for this
 *  portal's sign-in is the very sign-in being asked for: it is not held up by that run. */
export function signInLocked(portal: Portal): string | null {
  if (app.state?.dryRun) return t.error.text('dryRun', {});
  if (run.loginNeeded === portal) return null;
  return run.active ? run.busyText : null;
}
