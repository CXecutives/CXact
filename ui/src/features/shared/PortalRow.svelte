<!--
  One portal in the list of Einstellungen > Jobportale (and the setup's Postfach once it is
  connected, `setup`: only its tile, name, state and "Alert anlegen"), a SettingRow like
  every row: its tile (the navy tint, its two capitals), its name, under it
  one quiet line of its state ("Zuletzt 4 neue Jobs", "Noch keine Suche"; "24 Alert-Mails in
  30 Tagen", or "Braucht ein Postfach" without one; "Pausiert bis …" while it rests), then
  its calls where they apply, outlined like every text button of a row ("Anmelden" or
  "Abmelden" where the portal offers a sign-in, "Alert anlegen" for a portal of alert mails:
  its page in the browser), the portal in the browser (a quiet icon, only for the portals the
  app searches: "Alert anlegen" is that way for the others) and its switch, always last (the
  name names the switch but, like every text next to a switch, does not switch it); at the
  smallest window the calls go to a line of their own at the row's end. A problem of the
  portal is one quiet line under its state (whether the user
  has to act, the time and the reason where it has them, "Alert-Mail öffnen" when alert mails
  came without jobs); it unfolds and folds away, so the rows below glide. A portal that is on
  and sent no alert mail for a week before the last fetch says so in one quiet line ("Seit 9
  Tagen keine Alert-Mail"; its alert may have run out) with "Alert prüfen", its page in the
  browser.
  Signing in lets the fetch use the sign-in, signing out ends that (lib/state/portalSession.ts,
  also the reader's "Anmelden"). A stored sign-in that the
  fetch does not use looks like none while the portal is on, and "Anmelden" then only lets
  the fetch use it (no sign-in window); while the portal is off the row keeps "Abmelden"
  until the sign-in is gone. A run holds the sign-in (both buttons wait with its reason). A
  switch moves at once; a failure puts it back and says why in the row. The switch itself is
  the answer: no toast.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import IconTile from '$components/IconTile.svelte';
  import Notice from '$components/Notice.svelte';
  import SettingRow from '$components/SettingRow.svelte';
  import Toggle from '$components/Toggle.svelte';
  import { t } from '$lib/i18n/t';
  import { errorText, healthAdvice } from '$lib/i18n/texts';
  import { invoke } from '$lib/ipc/api';
  import type { PortalState } from '$lib/ipc/types';
  import { PORTAL_MONOGRAM } from '$lib/ipc/types/portals';
  import { fade, unfold } from '$lib/motion/transitions';
  import { app } from '$lib/state/app.svelte';
  import {
    portalSession,
    savePortal,
    signInLocked,
    type PortalSwitches,
  } from '$lib/state/portalSession';
  import { run } from '$lib/state/run.svelte';

  interface Props {
    portal: PortalState;
    /** The setup's row: no sign-in, no link to the portal, no switch. */
    setup?: boolean;
  }
  let { portal, setup = false }: Props = $props();

  /** A week without an alert mail of a portal that is on: its row says so. */
  const QUIET_DAYS = 7;
  const DAY_MS = 24 * 60 * 60 * 1000;
  /** Why the last action failed, said when it shows. */
  let error = $state<(() => string) | null>(null);
  let busy = $state(false);

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
   *  (before a fetch or without any alert mail yet the app knows nothing to say). */
  const quietDays = $derived.by((): number | null => {
    const last = portal.lastAlert === null ? Number.NaN : Date.parse(portal.lastAlert);
    const fetch = app.state?.lastRun ?? null;
    if (!portal.enabled || Number.isNaN(last)) return null;
    if (fetch?.outcome.kind !== 'completed') return null;
    if (Date.parse(fetch.finishedAt) - last < QUIET_DAYS * DAY_MS) return null;
    return Math.floor((Date.now() - last) / DAY_MS);
  });
  /** Its state: resting until a moment, a portal of alert mails without a mailbox, how many
   *  alert mails came in 30 days, or what the last search brought from it ("noch keine
   *  Suche" before the first, nothing when it was not asked). */
  const standing = $derived.by((): string | null => {
    const now = portal.health;
    if (now.kind === 'paused' && now.until !== null) return t.settings.pausedUntil(now.until);
    if (now.kind === 'quotaReached') return t.settings.pausedUntil(now.until);
    if (portal.way === 'alert') {
      if (!app.hasMailbox) return t.settings.needsMailbox;
      // Before the first fetch: what "Verbinden" counted in the mailbox.
      const mails =
        portal.alertMails ??
        app.state?.mailbox.check?.perPortal.find((c) => c.portal === portal.portal)?.count ??
        null;
      return mails === null ? null : t.settings.alertMails(mails);
    }
    const last = app.state?.lastRun ?? null;
    if (last === null) return t.settings.noSearchYet;
    const line = last.perPortal.find((p) => p.portal === portal.portal);
    return line === undefined ? null : t.settings.lastNew(line.new);
  });
  /** Its problem in one sentence, where the state line does not say it already. */
  const problem = $derived(
    health !== null &&
      portal.enabled &&
      !(portal.health.kind === 'paused' && portal.health.until !== null) &&
      portal.health.kind !== 'quotaReached'
      ? health
      : null,
  );
  /** A sign-in is stored (in the session window's profile). */
  const stored = $derived(portal.signedIn === true);
  /** Signed in as the fetch sees it: a stored sign-in it does not use counts as none while
   *  the portal is on; while it is off the stored one shows, so it can be removed. */
  const signedIn = $derived(stored && (portal.loginEnabled || !portal.enabled));
  /** Where the portal offers a sign-in, also for a stored sign-in of a portal that is off
   *  (its Abmelden stays until it is gone). */
  const loginShown = $derived(portal.login === 'optional' && (portal.enabled || stored));
  const loginLocked = $derived(signInLocked());

  async function change(patch: PortalSwitches): Promise<void> {
    error = null;
    try {
      await savePortal(portal.portal, patch);
    } catch (failure) {
      error = () => errorText(failure);
    }
  }

  async function session(on: boolean): Promise<void> {
    error = null;
    busy = true;
    try {
      await portalSession(portal, on);
    } catch (failure) {
      error = () => errorText(failure);
    } finally {
      busy = false;
    }
  }

  function open(target: 'home' | 'setup' | { gmailId: string }): void {
    error = null;
    invoke('open_target', {
      target:
        target === 'home'
          ? { kind: 'portalHome', portal: portal.portal }
          : target === 'setup'
            ? { kind: 'portalSetup', portal: portal.portal }
            : { kind: 'alertMail', gmailId: target.gmailId },
    }).catch((failure: unknown) => (error = () => errorText(failure)));
  }
</script>

{#snippet tile()}
  <IconTile tone="navy" monogram={PORTAL_MONOGRAM[portal.portal]} size="sm" />
{/snippet}

{#snippet notes()}
  {#if problem}
    <div class="fold" transition:unfold>
      <div class="line">
        <Notice
          tone={portal.actionNeeded ? 'warning' : 'info'}
          variant="inline"
          text={problem}
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
{/snippet}

{#snippet end()}
  {#if portal.way !== 'alert'}
    <Button
      variant="ghost"
      iconOnly
      icon="external"
      label={t.settings.openPortal}
      testid="open-portal-{portal.portal}"
      onclick={() => open('home')}
    />
  {/if}
  <span class="switch">
    <Toggle
      {id}
      checked={portal.enabled}
      label={t.portal[portal.portal]}
      testid="toggle-enabled-{portal.portal}"
      onchange={(on) => change({ enabled: on })}
    />
  </span>
{/snippet}

<SettingRow
  label={t.portal[portal.portal]}
  hint={standing}
  for={setup ? null : id}
  lead={tile}
  {notes}
  end={setup ? null : end}
  testid="portal-{portal.portal}"
>
  {#if loginShown && !setup}
    <span class="sign" transition:fade>
      {#if signedIn}
        <Button
          variant="secondary"
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
  {#if portal.way === 'alert'}
    <Button
      variant="secondary"
      icon="alertAdd"
      label={t.settings.setUpAlert}
      testid="setup-{portal.portal}"
      onclick={() => open('setup')}
    />
  {/if}
</SettingRow>

<style>
  .switch {
    display: flex;
  }

  .fold {
    display: flex;
    flex-direction: column;
  }

  .line {
    display: flex;
    padding-top: var(--space-6);
  }

  /* The sign-in fades in and out on its own, before "Alert anlegen". */
  .sign {
    display: flex;
  }
</style>
