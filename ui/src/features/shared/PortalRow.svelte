<!--
  One portal in Einstellungen > Jobportale (round 10 draft), a SettingRow like every row: its
  brand name (`t.portal`), under it one line of its state, then its calls and at the right
  its switch, always last (the name names the switch but, like every text next to a switch,
  does not switch it).
  The line: a status word (StatusText) while something holds the portal, "Pausiert bis …"
  (warning) while it rests, "Anmeldung abgelaufen" (danger) when its sign-in ran out,
  "Wartet auf die Anmeldung" (warning) while its sign-in window waits, the word of a problem
  ("Alert-Mails ohne Jobs"; "Fehlgeschlagen" in red after a failed call), "Seit 9 Tagen keine
  Alert-Mail" (warning) when a portal that is on sent no alert mail for a week before the
  last fetch; else its quiet state ("Zuletzt 4 neue Jobs", "Noch keine Suche"; "24 Alert-Mails in
  30 Tagen").
  The calls, outlined with the glyph of their meaning: "Anmelden…" or "Abmelden" where the
  portal offers a sign-in (one width), then the one call about its alert, in one place and
  one width whatever its face (it follows the portal's state, never the pointer), so
  Anmelden never moves: "Alert-Mail öffnen" when alert mails came without jobs, "Alert
  prüfen…" when its alert went quiet, else "Alert anlegen…" for a portal of alert mails (its
  page in the browser). A call that opens a window or a page to act on ends in an ellipsis.
  A portal that is off offers no call about its alert. In a narrow box the calls go to a
  line of their own at the row's end.
  A portal of alert mails without a mailbox cannot work: its name dims, its line says so
  quietly ("Braucht ein Postfach"; the Postfach card is the one way to connect one), it has
  no calls, and its switch stands off and waits with its reason (the stored value stays;
  decision 26).
  A problem of the portal is its sentence in one quiet line under the word (whether the user
  has to act, the time and the reason where it has them); it unfolds and folds away, so the
  rows below glide. "Alert-Mail öffnen" and "Alert prüfen" need the mail's place in Gmail, so
  they wait for the other providers (decision 32).
  Signing in lets the fetch use the sign-in, signing out ends that (lib/state/portalSession.ts,
  also the reader's "Anmelden"). A stored sign-in that the fetch does not use looks like none
  while the portal is on, and "Anmelden" then only lets the fetch use it (no sign-in window);
  while the portal is off the row keeps "Abmelden" until the sign-in is gone. A run holds the
  sign-in (both buttons wait with its reason), except while it waits for this portal's own
  sign-in: the button is the way to give it. A switch moves at once, and the calls that go
  with a portal switched off fade out together, none jumping into the room of another; a
  failure puts it back and says why in the row. The switch itself is the answer: no toast.
-->
<script lang="ts">
  import Button, { type ButtonFace } from '$components/Button.svelte';
  import type { IconName } from '$components/Icon.svelte';
  import SettingRow from '$components/SettingRow.svelte';
  import type { StatusTone } from '$components/StatusText.svelte';
  import Toggle from '$components/Toggle.svelte';
  import { t } from '$lib/i18n/t';
  import { errorText, healthAdvice } from '$lib/i18n/texts';
  import { invoke } from '$lib/ipc/api';
  import type { PortalState } from '$lib/ipc/types';
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
  }
  let { portal }: Props = $props();

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
  /** A portal of alert mails without a mailbox: it cannot work (decision 26). */
  const idle = $derived(portal.way === 'alert' && !app.hasMailbox);
  /** The ways out of a problem need the mail's place in Gmail (decision 32). */
  const gmail = $derived(app.state?.mailbox.provider === 'gmail');
  /** What holds the portal, as a status word in its line (null: its quiet state). */
  const status = $derived.by((): { tone: StatusTone; text: string } | null => {
    const now = portal.health;
    if (idle) return null;
    if (now.kind === 'paused' && now.until !== null)
      return { tone: 'warning', text: t.settings.pausedUntil(now.until) };
    if (now.kind === 'quotaReached')
      return { tone: 'warning', text: t.settings.pausedUntil(now.until) };
    if (run.loginNeeded === portal.portal)
      return { tone: 'warning', text: t.settings.signInWaiting };
    if (now.kind === 'loginRequired' && portal.enabled)
      return { tone: 'danger', text: t.settings.signInExpired };
    return null;
  });
  /** One of those mails to look at in Gmail (from the last fetch). */
  const alertMail = $derived(
    emptyMails > 0 && gmail
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
    if (!portal.enabled || idle || Number.isNaN(last)) return null;
    if (fetch?.outcome.kind !== 'completed') return null;
    if (Date.parse(fetch.finishedAt) - last < QUIET_DAYS * DAY_MS) return null;
    return Math.floor((Date.now() - last) / DAY_MS);
  });
  /** Its quiet state: how many alert mails came in 30 days (a portal of alert mails without a
   *  mailbox says it needs one), or what the last search brought from it ("noch keine Suche"
   *  before the first, nothing when it was not asked). */
  const standing = $derived.by((): string | null => {
    if (portal.way === 'alert') {
      if (idle) return t.settings.needsMailbox;
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
  /** Its problem in one sentence, where the status word does not say it already (the
   *  sentence says whether she has to act). */
  const problem = $derived(
    portal.enabled && !idle && status === null && portal.health.kind !== 'loginRequired'
      ? healthAdvice(portal.health)
      : null,
  );
  /** The word of its line: a failed call, what holds it, its problem, a quiet alert. */
  const flag = $derived.by((): { tone: StatusTone; text: string } | null => {
    if (error) return { tone: 'danger', text: t.settings.problem.failed };
    if (status) return status;
    if (problem) {
      const now = portal.health;
      const word =
        now.kind === 'layoutSuspect'
          ? now.emptyMails > 0
            ? t.settings.problem.emptyMails
            : t.settings.problem.pages
          : t.settings.problem.paused;
      return { tone: 'warning', text: word };
    }
    if (quietDays !== null) return { tone: 'warning', text: t.settings.problem.quiet(quietDays) };
    return null;
  });
  /** A sign-in is stored (in the session window's profile). */
  const stored = $derived(portal.signedIn === true);
  /** Signed in as the fetch sees it: a stored sign-in it does not use counts as none while
   *  the portal is on; while it is off the stored one shows, so it can be removed. */
  const signedIn = $derived(stored && (portal.loginEnabled || !portal.enabled));
  /** Where the portal offers a sign-in, also for a stored sign-in of a portal that is off
   *  (its Abmelden stays until it is gone). */
  const loginShown = $derived(portal.login === 'optional' && !idle && (portal.enabled || stored));
  const loginLocked = $derived(signInLocked(portal.portal));

  /** The one call about its alert, in one place: the mail that came without jobs, the alert
   *  that went quiet, or a new alert (a portal of alert mails); none while the portal is
   *  off. */
  const alert = $derived.by(
    (): { id: string; label: string; icon: IconName; onclick: () => void } | null => {
      if (idle || !portal.enabled) return null;
      if (alertMail !== null) {
        const gmailId = alertMail;
        return {
          id: 'alert-mail',
          label: t.reader.mail,
          icon: 'alertMail',
          onclick: () => open({ gmailId }),
        };
      }
      if (quietDays !== null && gmail) {
        return {
          id: 'check-alert',
          label: t.settings.checkAlert,
          icon: 'external',
          onclick: () => open('home'),
        };
      }
      return portal.way === 'alert' ? setUp : null;
    },
  );
  const setUp = $derived({
    id: 'setup',
    label: t.settings.setUpAlert,
    icon: 'alertAdd' as IconName,
    onclick: () => open('setup'),
  });
  /** Every face of the alert's call: it keeps the width of the widest. */
  const ALERT_FACES: readonly ButtonFace[] = [
    { label: t.settings.setUpAlert, icon: 'alertAdd' },
    { label: t.reader.mail, icon: 'alertMail' },
    { label: t.settings.checkAlert, icon: 'external' },
  ];

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

{#snippet notes()}
  {#if problem}
    <div class="fold" transition:unfold>
      <p class="line" data-copy data-testid="health-{portal.portal}">{problem}</p>
    </div>
  {/if}
  {#if error}
    <div class="fold" transition:unfold>
      <p class="line" data-copy data-testid="portal-error">{error()}</p>
    </div>
  {/if}
{/snippet}

{#snippet end()}
  <span class="switch">
    <Toggle
      {id}
      checked={portal.enabled && !idle}
      disabled={idle}
      disabledReason={idle ? t.settings.needsMailboxReason : null}
      label={t.portal[portal.portal]}
      testid="toggle-enabled-{portal.portal}"
      onchange={(on) => change({ enabled: on })}
    />
  </span>
{/snippet}

<SettingRow
  label={t.portal[portal.portal]}
  hint={flag?.text ?? standing}
  status={flag?.tone ?? null}
  disabled={idle}
  for={id}
  {notes}
  {end}
  testid="portal-{portal.portal}"
>
  {#if loginShown}
    <span class="sign" transition:fade>
      {#if signedIn}
        <Button
          variant="secondary"
          icon="signOut"
          label={t.settings.signOut}
          sizeTo={[{ label: t.settings.signIn, icon: 'signIn' }]}
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
          sizeTo={[{ label: t.settings.signOut, icon: 'signOut' }]}
          loading={busy}
          disabled={loginLocked !== null}
          disabledReason={loginLocked}
          testid="sign-in-{portal.portal}"
          onclick={() => void session(true)}
        />
      {/if}
    </span>
  {/if}
  {#if alert}
    <span class="call" transition:fade>
      <Button
        variant="secondary"
        icon={alert.icon}
        label={alert.label}
        sizeTo={ALERT_FACES}
        testid="{alert.id}-{portal.portal}"
        onclick={alert.onclick}
      />
    </span>
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

  /* A problem's sentence: quiet, like the line under the name, the word above says it. */
  .line {
    padding-top: var(--space-2);
    color: var(--text-muted);
    font: var(--type-sm);
  }

  /* The sign-in and the alert's call fade in and out together, each in its place: the one that
     stays never jumps over the room of the one that goes while it fades. */
  .sign,
  .call {
    display: flex;
  }
</style>
