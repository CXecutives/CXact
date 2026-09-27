<!--
  One portal in the card Portale, the same row for each: its tile and name, the calls of today
  ("Heute 23 von 100 Aufrufen", counted from midnight) with their meter, then "Anmelden" or
  "Abmelden" where the portal offers a sign-in, the portal in the browser (in one column in
  every row) and its switch (the name names the switch but, like every text next to a switch,
  does not switch it). The meter turns ochre near the limit and while the portal rests. A
  problem of the portal is one quiet line under the meter (whether the user has to act, the
  time and the reason where it has them, "Alert-Mail öffnen" when alert mails came without
  jobs); it unfolds and folds away, so the rows below glide. A portal that is on and sent no
  alert mail for a week before the last fetch says so in one quiet line ("Seit 9 Tagen keine
  Alert-Mail"; its alert may have run out) with "Alert prüfen", its page in the browser. The
  demo asks no portal and reads no mailbox: no calls, no meter, no such line.
  Signing in lets the fetch use the sign-in, signing out ends that. A stored sign-in that the
  fetch does not use looks like none while the portal is on, and "Anmelden" then only lets
  the fetch use it (no sign-in window); while the portal is off the row keeps "Abmelden"
  until the sign-in is gone. A run holds the sign-in (both buttons wait with its reason). A
  switch moves at once (the state is patched before the save); a failure puts it back and
  says why in the row. The switch itself is the answer: no toast.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import IconTile from '$components/IconTile.svelte';
  import Meter from '$components/Meter.svelte';
  import Notice from '$components/Notice.svelte';
  import Toggle from '$components/Toggle.svelte';
  import { t } from '$lib/i18n/t';
  import { errorText, healthAdvice } from '$lib/i18n/texts';
  import { invoke } from '$lib/ipc/api';
  import type { PortalState } from '$lib/ipc/types';
  import { PORTAL_MONOGRAM } from '$lib/ipc/types/portals';
  import { fade, unfold } from '$lib/motion/transitions';
  import { app } from '$lib/state/app.svelte';
  import { run } from '$lib/state/run.svelte';
  import { settingsPatch } from './cards';

  interface Props {
    portal: PortalState;
  }
  let { portal }: Props = $props();

  type Switches = Partial<Pick<PortalState, 'enabled' | 'loginEnabled'>>;

  /** A week without an alert mail of a portal that is on: its row says so. */
  const QUIET_DAYS = 7;
  const DAY_MS = 24 * 60 * 60 * 1000;
  /** Why the last action failed, said when it shows (so in the language of the moment). */
  let error = $state<(() => string) | null>(null);
  let busy = $state(false);
  /** Only the answer to the latest save may replace the state (quick double flips). */
  let saves = 0;

  const id = $derived(`switch-enabled-${portal.portal}`);
  /** Alert mails of the portal that came without jobs (a mail problem, not one of the pages). */
  const emptyMails = $derived(
    portal.health.kind === 'layoutSuspect' ? portal.health.emptyMails : 0,
  );
  /** Its problem in one sentence; `portal.actionNeeded` says whether she has to act. The
   *  sign-in window that waits for her says so instead. */
  const health = $derived(
    run.loginNeeded === portal.portal ? t.settings.signInWaiting : healthAdvice(portal.health),
  );
  /** One of those mails to look at in Gmail (from the last fetch). */
  const alertMail = $derived(
    emptyMails > 0
      ? (app.state?.lastRun?.emptyAlerts.find(
          (alert) => alert.portal === portal.portal && alert.gmailId !== null,
        )?.gmailId ?? null)
      : null,
  );
  /** Days since its last alert mail, while the last fetch found none for a week or longer
   *  (before a fetch, without any alert mail yet, or in the demo, which reads no mailbox, the
   *  app knows nothing to say). */
  const quietDays = $derived.by((): number | null => {
    const last = portal.lastAlert === null ? Number.NaN : Date.parse(portal.lastAlert);
    const fetch = app.state?.lastRun ?? null;
    if (app.state?.demo || !portal.enabled || Number.isNaN(last)) return null;
    if (fetch?.outcome.kind !== 'completed') return null;
    if (Date.parse(fetch.finishedAt) - last < QUIET_DAYS * DAY_MS) return null;
    return Math.floor((Date.now() - last) / DAY_MS);
  });
  /** The calls of today and their share of the day's limit; none in the demo, which asks no
   *  portal (its note says so). */
  const quota = $derived.by(() => {
    const q = portal.quota;
    if (q === null || app.state?.demo) return null;
    const share = q.usedDay / Math.max(q.capDay, 1);
    return { share, text: t.settings.quota(q.usedDay, q.capDay) };
  });
  /** A sign-in is stored (in the session window's profile). */
  const stored = $derived(portal.signedIn === true);
  /** Signed in as the fetch sees it: a stored sign-in it does not use counts as none while
   *  the portal is on; while it is off the stored one shows, so it can be removed. */
  const signedIn = $derived(stored && (portal.loginEnabled || !portal.enabled));
  /** Where the portal offers a sign-in, also for a stored sign-in of a portal that is off
   *  (its Abmelden stays until it is gone). */
  const loginShown = $derived(portal.login === 'optional' && (portal.enabled || stored));
  /** The dry run and the demo touch no portal: no sign-in, no sign-out (the backend refuses
   *  them the same way). */
  const noPortal = $derived(
    app.state?.dryRun
      ? t.error.text('dryRun', {})
      : app.state?.demo
        ? t.error.text('demo', {})
        : null,
  );
  const loginLocked = $derived(noPortal ?? (run.active ? run.busyText : null));

  async function change(patch: Switches): Promise<void> {
    error = null;
    const save = ++saves;
    // The switch and what hangs on it follow at once, not after the round trip.
    const item = app.state?.portals.find((p) => p.portal === portal.portal);
    if (item) Object.assign(item, patch);
    try {
      const next = await invoke('save_settings', {
        patch: settingsPatch({
          portals: [
            {
              portal: portal.portal,
              enabled: patch.enabled ?? null,
              loginEnabled: patch.loginEnabled ?? null,
            },
          ],
        }),
      });
      if (save === saves) app.set(next);
    } catch (failure) {
      error = () => errorText(failure);
      void app.load();
    }
  }

  /** Anmelden: the sign-in window (unless a sign-in is stored), and once signed in the fetch
   *  uses it; Abmelden ends both. */
  async function session(on: boolean): Promise<void> {
    error = null;
    busy = true;
    try {
      const done =
        on && stored
          ? true
          : await invoke(on ? 'portal_login' : 'portal_logout', { portal: portal.portal });
      if (done && portal.loginEnabled !== on) await change({ loginEnabled: on });
      await app.load();
    } catch (failure) {
      error = () => errorText(failure);
    } finally {
      busy = false;
    }
  }

  function open(target: 'home' | { gmailId: string }): void {
    error = null;
    invoke('open_target', {
      target:
        target === 'home'
          ? { kind: 'portalHome', portal: portal.portal }
          : { kind: 'alertMail', gmailId: target.gmailId },
    }).catch((failure: unknown) => (error = () => errorText(failure)));
  }
</script>

<!-- A row of the card like a SettingRow (edge to edge, its own padding: `data-setting-row`
     keeps the card's inset for other content off it). -->
<div class="row" data-setting-row data-testid="portal-{portal.portal}">
  <IconTile tone="navy" monogram={PORTAL_MONOGRAM[portal.portal]} size="md" />
  <div class="text">
    <span class="name" id="{id}-label">{t.portal[portal.portal]}</span>
    {#if quota}
      <div class="quota" data-testid="quota-{portal.portal}">
        <span>{quota.text}</span>
        <Meter value={quota.share} size="sm" label={quota.text} />
      </div>
    {/if}
    {#if health && portal.enabled}
      <div class="fold" transition:unfold>
        <div class="line">
          <Notice
            tone={portal.actionNeeded ? 'warning' : 'info'}
            variant="inline"
            text={health}
            action={alertMail
              ? {
                  label: t.reader.mail,
                  icon: 'alertMail',
                  onclick: () => open({ gmailId: alertMail }),
                }
              : null}
            testid="health-{portal.portal}"
          />
        </div>
      </div>
    {/if}
    {#if quietDays !== null}
      <div class="fold" transition:unfold>
        <div class="line">
          <Notice
            tone="warning"
            variant="inline"
            text={t.settings.alertQuiet(quietDays)}
            action={{
              label: t.settings.checkAlert,
              icon: 'external',
              onclick: () => open('home'),
            }}
            testid="alert-quiet-{portal.portal}"
          />
        </div>
      </div>
    {/if}
    {#if error}
      <div class="fold" transition:unfold>
        <div class="line">
          <Notice tone="danger" variant="inline" text={error()} testid="portal-error" />
        </div>
      </div>
    {/if}
  </div>
  <div class="tools">
    {#if loginShown}
      <span class="login" transition:fade>
        {#if signedIn}
          <Button
            variant="secondary"
            size="sm"
            icon="signOut"
            label={t.settings.signOut}
            loading={busy}
            disabled={loginLocked !== null}
            disabledReason={loginLocked}
            testid="sign-out-{portal.portal}"
            onclick={() => void session(false)}
          />
        {:else}
          <Button
            variant="secondary"
            size="sm"
            icon="signIn"
            label={t.settings.signIn}
            loading={busy}
            disabled={loginLocked !== null}
            disabledReason={loginLocked}
            testid="sign-in-{portal.portal}"
            onclick={() => void session(true)}
          />
        {/if}
      </span>
    {/if}
    <Button
      variant="ghost"
      size="sm"
      iconOnly
      icon="external"
      label={t.settings.openPortal}
      testid="open-portal-{portal.portal}"
      onclick={() => open('home')}
    />
    <Toggle
      {id}
      checked={portal.enabled}
      label={t.portal[portal.portal]}
      testid="toggle-enabled-{portal.portal}"
      onchange={(on) => change({ enabled: on })}
    />
  </div>
</div>

<style>
  /* A row of the card, edge to edge like a SettingRow: its divider and its inset. */
  .row {
    display: flex;
    align-items: flex-start;
    gap: var(--space-12);
    margin-inline: calc(-1 * var(--row-inset));
    padding: var(--space-16) var(--row-inset);
    border-bottom: var(--border-width) solid var(--border);
  }

  .row:last-child {
    border-bottom: 0;
  }

  /* Name, calls and lines 6 apart; a line brings its 6 along, so it folds in one piece. */
  .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }

  .name {
    color: var(--text);
    font: var(--type-md);
    font-weight: var(--weight-medium);
  }

  /* The calls of today and, under them, their meter (as wide as a form's field). */
  .quota {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    max-width: var(--stat-min);
    margin-top: var(--space-6);
    color: var(--text-muted);
    font: var(--type-sm);
    font-variant-numeric: var(--numeric);
  }

  .fold {
    display: flex;
    flex-direction: column;
  }

  .line {
    display: flex;
    padding-top: var(--space-6);
  }

  /* 12 apart, like the buttons and the switch of every other row of the page. */
  .tools {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-12);
    min-height: var(--tile-md);
  }

  .login {
    display: inline-flex;
  }
</style>
