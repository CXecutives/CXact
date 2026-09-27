<!--
  First run (full page) on the white sheet, in the column of every view: the app mark beside
  its name and the steps of steps.ts that tick themselves: connect the mailbox, a usable
  profile (made in the Profil view, whose editor also imports a file or a CV), fetch. No
  sentence introduces them: each step is its name and the controls it needs. The next open
  step carries the one primary button; the fetch stays locked with its reason until a mailbox
  is connected. After "Alles zurücksetzen" the app starts here again: a clean reset says so
  once in a toast, one that left something stands as a warning above the steps with the way
  to the log. Compact enough that all three steps are in view at 1280 x 720 on both OS; the
  sidebar works as always, with Jobs current while this page stands for it.

  A vertical stepper: 28 px markers (the current one in the tooltip's dark, "you are here";
  upcoming ones outlined; done ones green with a check) joined by a hairline that fills green
  below a done step. Ticking a step is a class change, so it moves only while the page is
  open: the marker cross-fades to its check, which draws itself, the line fills downwards,
  the next marker turns dark and the done text rises in. Nothing plays when the page appears.

  Step 1 names the portals that are on, in the UI's order, since their alert mails must go
  to this address (none on: a warning with "Einstellungen öffnen"); connected, the sentence
  no longer names them, since the list under it does: each of them with the alert mails
  "Verbinden" found in the last 30 days, or "Alert anlegen" (the portal's page) where it
  found none. Step 2 happens in the Profil view: "Aus Lebenslauf anlegen" opens its steps
  with an AI at once, "Profil anlegen" the empty form (the same button as on the Profil
  view's empty state); after the first save the Profil view's toast offers the way on. Step 3 says only what is wrong: no
  alert mail came (an alert comes first), or the first fetch failed (the app leaves this page
  only after a completed one), with the fitting action where there is one besides the fetch.
  Every main action is 32 px.
-->
<script lang="ts" module>
  /** The toast of a clean reset shows once per start of the app. */
  let told = false;
</script>

<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import BrandMark from '$components/BrandMark.svelte';
  import Button from '$components/Button.svelte';
  import Card from '$components/Card.svelte';
  import Icon from '$components/Icon.svelte';
  import Notice from '$components/Notice.svelte';
  import { t } from '$lib/i18n/t';
  import { errorText } from '$lib/i18n/texts';
  import { invoke } from '$lib/ipc/api';
  import type { OpenTarget, Portal } from '$lib/ipc/types';
  import { rise } from '$lib/motion/transitions';
  import { inPortalOrder } from '$lib/portals';
  import { app } from '$lib/state/app.svelte';
  import { navigation } from '$lib/state/navigation.svelte';
  import { editor } from '$lib/state/profile.svelte';
  import { failureAction, isFetch, run } from '$lib/state/run.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import MailboxForm from '../shared/MailboxForm.svelte';
  import { STEPS, type StepId } from './steps';

  /** Done, per step, as the page shows it now. */
  const done = $derived(
    Object.fromEntries(STEPS.map((step) => [step.id, step.done()])) as Record<StepId, boolean>,
  );
  /** The step whose action is the primary one: the first that is not done. */
  const current = $derived(STEPS.find((step) => !done[step.id])?.id ?? null);

  const profile = $derived(app.state?.profile ?? null);
  /** Why an existing profile does not count yet (null: there is none, or it is fine). */
  const profileProblem = $derived(
    profile === null || done.profile
      ? null
      : profile.parseError
        ? t.profile.unreadable
        : t.firstRun.profileEmpty,
  );
  /** Who the profile is about: the name, else the role, else what the Profil view calls a
   *  profile without a name. */
  const profileName = $derived(
    profile?.form?.name.trim() || profile?.form?.title.trim() || t.profile.unnamed,
  );

  /** The portals whose alerts are wanted (the ones switched on), in the UI's order. */
  const portals = $derived(inPortalOrder(app.state?.portals ?? []).filter((p) => p.enabled));
  /** What "Verbinden" found per portal in this session (null: not asked in this session). */
  const check = $derived(app.state?.mailbox.check ?? null);
  const mailsOf = (portal: Portal): number | null =>
    check?.perPortal.find((count) => count.portal === portal)?.count ?? null;
  /** "Verbinden" found no alert mail of any portal: a fetch would find nothing yet. */
  const noAlerts = $derived(check !== null && check.total === 0);

  /** Steps ticked while this page is open: only their check draws (never at mount). */
  let ticked = $state<Partial<Record<StepId, boolean>>>({});
  let before = untrack(() => ({ ...done }));
  /** Where each step's actions are: a step's form that had the focus goes, the next one's
   *  first button takes it. */
  const actions: Partial<Record<StepId, HTMLElement>> = {};
  $effect(() => {
    const now = { ...done };
    for (const [index, step] of STEPS.entries()) {
      if (!now[step.id] || before[step.id]) continue;
      ticked[step.id] = true;
      const next = STEPS[index + 1];
      if (next !== undefined && document.activeElement === document.body) {
        queueMicrotask(() => actions[next.id]?.querySelector('button')?.focus());
      }
    }
    before = now;
  });

  /** A new profile opens as a form right away; an existing one opens as it is. */
  function openProfile(): void {
    if (profile === null && editor.origin === null) editor.create();
    navigation.go('profile');
  }

  /** The steps with an AI open in the Profil view (it copies the prompt as it appears). */
  function fromCv(): void {
    editor.cvWanted = true;
    navigation.go('profile');
  }

  /** Where the step's link or button failed to open (said in the step). */
  let openError = $state<{ step: StepId; text: () => string } | null>(null);
  function open(step: StepId, target: OpenTarget): void {
    openError = null;
    invoke('open_target', { target }).catch(
      (error: unknown) => (openError = { step, text: () => errorText(error) }),
    );
  }

  /** The first fetch that failed (this session, else the last one the app knows): its words
   *  and the fitting action (none where "Postfach abrufen" is the way on). */
  const failed = $derived.by(() => {
    if (run.active) return null;
    const last = run.summary ?? app.state?.lastRun ?? null;
    if (last === null || !isFetch(last.kind) || last.outcome.kind !== 'failed') return null;
    const error = last.outcome.error;
    return {
      text: t.error.text(error.kind, error.params),
      action: failureAction(last, error, () => open('fetch', { kind: 'logDir' })),
    };
  });

  /** After "Alles zurücksetzen": what it could not delete stays a warning with the way to
   *  the log (each item is named there); a clean reset says so once. */
  const reset = $derived(app.state?.resetReport ?? null);
  const resetLeft = $derived(reset !== null && reset.failed > 0 && !done.mailbox);
  onMount(() => {
    if (reset !== null && reset.failed === 0 && !told) {
      told = true;
      toasts.show(t.settings.resetDone);
    }
  });
</script>

{#snippet marker(index: number, id: StepId)}
  <span
    class="marker"
    class:done={done[id]}
    class:drawn={ticked[id] === true}
    class:current={current === id}
    aria-hidden="true"
  >
    <span class="number">{index + 1}</span>
    <span class="check"><Icon name="check" size="sm" /></span>
  </span>
{/snippet}

{#snippet problem(text: string, testid: string)}
  <!-- In the place and size of the hint, with the glyph and tone of a warning. -->
  <p class="hint problem" data-testid={testid}>
    <Icon name="warning" size="sm" /><span>{text}</span>
  </p>
{/snippet}

{#snippet mailbox()}
  {#if done.mailbox}
    <!-- The address the portals' alert mails must go to (text to copy), then per portal what
         "Verbinden" found, or its page to set up an alert. -->
    <div class="head">
      <h2 class="name">{t.firstRun.mailbox}</h2>
      <p class="done-text" data-copy in:rise>{app.state?.mailbox.user}</p>
    </div>
    {#if portals.length > 0}
      <p class="hint" data-testid="first-mailbox-hint">{t.firstRun.mailboxDone}</p>
      <ul class="alerts" data-testid="first-alerts">
        {#each portals as portal (portal.portal)}
          {@const mails = mailsOf(portal.portal)}
          <li class="alert" data-testid="first-portal-{portal.portal}">
            <span class="portal">{t.portal[portal.portal]}</span>
            {#if mails !== null && mails > 0}
              <span class="count" data-testid="first-mails-{portal.portal}"
                >{t.firstRun.alertMails(mails)}</span
              >
            {:else}
              <Button
                variant="link"
                size="sm"
                icon="external"
                external
                label={t.firstRun.createAlert}
                testid="first-alert-{portal.portal}"
                onclick={() => open('mailbox', { kind: 'portalHome', portal: portal.portal })}
              />
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {:else}
    <div class="head">
      <h2 class="name">{t.firstRun.mailbox}</h2>
      {#if portals.length > 0}
        <p class="hint" data-testid="first-mailbox-hint">
          {t.firstRun.mailboxText(portals.map((p) => p.portal))}
        </p>
      {/if}
    </div>
    <MailboxForm autofocus />
  {/if}
  {#if portals.length === 0}
    <!-- Every portal is off: nothing would be read. -->
    {@render problem(t.firstRun.noPortal, 'first-no-portal')}
    <div class="actions">
      <Button
        variant="secondary"
        size="field"
        icon="settings"
        label={t.firstRun.openSettings}
        testid="first-open-settings"
        onclick={() => navigation.go('settings')}
      />
    </div>
  {/if}
{/snippet}

{#snippet profileStep()}
  <div class="head">
    <h2 class="name">{t.firstRun.profile}</h2>
    {#if done.profile}
      <p class="done-text" in:rise>{profileName}</p>
    {:else if profileProblem}
      {@render problem(profileProblem, 'first-profile-problem')}
    {/if}
  </div>
  {#if !done.profile}
    <!-- A new profile comes from the CV with an AI (the recommended way) or the empty form; an
         existing one that does not count yet opens as it is. -->
    <div class="actions" bind:this={actions.profile}>
      {#if profile}
        <Button
          variant={current === 'profile' ? 'primary' : 'secondary'}
          size="field"
          icon="document"
          label={t.list.openProfile}
          testid="first-profile"
          onclick={openProfile}
        />
      {:else}
        <Button
          variant={current === 'profile' ? 'primary' : 'secondary'}
          size="field"
          icon="paste"
          label={t.profile.fromCv}
          testid="first-profile"
          onclick={fromCv}
        />
        <Button
          variant="secondary"
          size="field"
          icon="add"
          label={t.profile.create}
          testid="first-profile-form"
          onclick={openProfile}
        />
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet fetch()}
  <div class="head">
    <h2 class="name">{t.firstRun.fetch}</h2>
    {#if noAlerts}
      {@render problem(t.firstRun.noAlerts, 'first-no-alerts')}
    {/if}
  </div>
  <div class="actions" bind:this={actions.fetch}>
    <Button
      variant={current === 'fetch' ? 'primary' : 'secondary'}
      size="field"
      icon="fetch"
      label={t.toolbar.fetch}
      disabled={run.fetchBlocked !== null}
      disabledReason={run.fetchBlocked}
      testid="first-fetch"
      onclick={() => void run.start({ kind: 'fetch' })}
    />
  </div>
  {#if run.startError}
    <Notice tone="danger" variant="inline" text={run.startError} />
  {:else if failed}
    <Notice
      tone="danger"
      variant="inline"
      text={failed.text}
      action={failed.action}
      testid="first-fetch-failed"
    />
  {/if}
{/snippet}

{#snippet body(id: StepId)}
  {#if id === 'mailbox'}
    {@render mailbox()}
  {:else if id === 'profile'}
    {@render profileStep()}
  {:else}
    {@render fetch()}
  {/if}
  {#if openError?.step === id}
    <Notice tone="danger" variant="inline" text={openError.text()} testid="open-error" />
  {/if}
{/snippet}

<div class="hero" data-testid="first-run">
  <div class="column">
    <header class="intro">
      <BrandMark size="lg" />
      <h1 class="title">{t.app.name}</h1>
    </header>

    {#if resetLeft && reset}
      <Notice
        tone="warning"
        text={t.settings.resetPartly(reset.failed)}
        action={{
          label: t.common.openLog,
          icon: 'folder',
          onclick: () => open('mailbox', { kind: 'logDir' }),
        }}
        testid="first-reset-report"
      />
    {/if}

    <Card padding="md">
      <ol class="steps" aria-label={t.firstRun.steps}>
        {#each STEPS as step, index (step.id)}
          <li
            class="step"
            class:done={done[step.id]}
            aria-current={current === step.id ? 'step' : undefined}
            data-testid="step-{step.id}"
            data-done={done[step.id]}
          >
            <div class="rail">
              {@render marker(index, step.id)}
              {#if index < STEPS.length - 1}<span class="line"><span class="fill"></span></span
                >{/if}
            </div>
            <div class="body">{@render body(step.id)}</div>
          </li>
        {/each}
      </ol>
    </Card>
  </div>
</div>

<style>
  /* The one inner padding of every content column, so the card lines up with the Profil and
     Einstellungen cards it leads to. */
  .hero {
    min-height: 100%;
    padding: var(--pane-padding) var(--pane-padding) var(--space-24);
  }

  .column {
    display: flex;
    flex-direction: column;
    gap: var(--space-20);
    max-width: var(--reader-width);
    margin: 0 auto;
  }

  /* The mark beside the name, like the app's lockup: one row, not two. */
  .intro {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-12);
  }

  .title {
    color: var(--text-heading);
    font: var(--type-2xl);
    letter-spacing: var(--tracking-tight);
  }

  /* No gap between the steps: the hairline runs on from one marker to the next. */
  .steps {
    display: flex;
    flex-direction: column;
  }

  .step {
    display: flex;
    gap: var(--space-16);
  }

  .rail {
    display: flex;
    flex: none;
    flex-direction: column;
    align-items: center;
  }

  .line {
    position: relative;
    flex: 1;
    width: var(--border-width);
    margin: var(--space-4) 0;
    overflow: hidden;
    background-color: var(--border);
  }

  /* The done part of the line fills downwards (a transform, so never at mount). */
  .fill {
    position: absolute;
    inset: 0;
    background-color: var(--success-strong);
    transform: scaleY(0);
    transform-origin: top;
    transition: transform var(--dur-slow) var(--ease-emphasized);
  }

  .step.done .fill {
    transform: none;
  }

  .marker {
    display: inline-grid;
    place-items: center;
    width: var(--control-sm);
    height: var(--control-sm);
    border: var(--border-width) solid var(--border-strong);
    border-radius: var(--radius-full);
    color: var(--text-muted);
    font: var(--type-sm);
    font-weight: var(--weight-semibold);
    font-variant-numeric: var(--numeric);
    transition:
      background-color var(--dur-fast) var(--ease-standard),
      border-color var(--dur-fast) var(--ease-standard),
      color var(--dur-fast) var(--ease-standard);
  }

  /* Number and check share the cell and cross-fade. */
  .number,
  .check {
    display: inline-flex;
    grid-area: 1 / 1;
    transition: opacity var(--dur-slow) var(--ease-standard);
  }

  .check,
  .done .number {
    opacity: 0;
  }

  .done .check {
    opacity: 1;
  }

  /* A step ticked while the page is open draws its check once (a class set by a change). */
  .drawn .check :global(path) {
    stroke-dasharray: var(--draw-length);
    animation: draw var(--dur-slow) var(--ease-out) both;
  }

  .marker.current {
    border-color: var(--surface-inverse);
    background-color: var(--surface-inverse);
    color: var(--text-inverse);
  }

  .marker.done {
    border-color: var(--success);
    background-color: var(--success-soft);
    color: var(--success-strong);
  }

  /* The heading's line centred on the 28 px marker; the space below a step keeps the line. */
  .body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-8);
    min-width: 0;
    padding-top: var(--space-2);
    padding-bottom: var(--space-20);
  }

  .step:last-child .body {
    padding-bottom: 0;
  }

  /* The step's name and, 4 px below it, its hint or what is done. */
  .head {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .name {
    color: var(--text-heading);
    font: var(--type-lg);
  }

  .hint,
  .count {
    color: var(--text-muted);
    font: var(--type-sm);
  }

  .done-text {
    color: var(--text-muted);
    font: var(--type-md);
  }

  /* The glyph sits on the first line when the sentence wraps. */
  .problem {
    display: flex;
    align-items: flex-start;
    gap: var(--space-6);
    color: var(--warning-strong);
  }

  .problem > :global(:first-child) {
    margin-top: calc((var(--leading-sm) - var(--icon-sm)) / 2);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-8) var(--space-16);
  }

  /* Each portal with what "Verbinden" found, or its page to set up an alert, one per line. */
  .alerts {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .alert {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-12);
    min-height: var(--control-sm);
  }

  .portal {
    min-width: var(--stat-min);
    color: var(--text);
    font: var(--type-sm);
  }
</style>
