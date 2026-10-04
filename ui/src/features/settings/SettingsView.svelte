<!--
  Einstellungen: one page under the view's sticky head ("Einstellungen"), in the column of the
  pages (640), three sections of cards.ts (design round 3): Portale (all ten portals in one
  list, PortalRow: the eight the app searches, then LinkedIn and freelance.de), Postfach für
  Alert-Mails (MailboxCard) and Daten (the profile's folder and the reset, each one sentence
  and its button). Every text button of a row is the same outlined button with its glyph;
  every row ends on the card's inner edge. This file only renders the list and runs its
  commands; what a row is, says and does is one entry in cards.ts.

  A switch moves at once (the state is patched before the save) and is its own answer.
  Errors stay a note at the end of their card, which unfolds (the cards below glide down
  instead of jumping). Only "Alle Daten zurücksetzen" and "Entfernen" of the mailbox ask
  first; a dialog whose action fails stays open and says why inside. The dry run changes
  nothing, and a run holds the mailbox and the reset, locked with the reason of that run
  instead of failing. Opened from a job for one portal ("Anmeldung einrichten") the page
  glides to the portal's row, focuses its sign-in and offers "Zurück zum Job" in its head.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import Card from '$components/Card.svelte';
  import Dialog from '$components/Dialog.svelte';
  import Notice, { type NoticeTone } from '$components/Notice.svelte';
  import PageHeader from '$components/PageHeader.svelte';
  import Section from '$components/Section.svelte';
  import SettingRow from '$components/SettingRow.svelte';
  import Skeleton from '$components/Skeleton.svelte';
  import { t } from '$lib/i18n/t';
  import { errorText } from '$lib/i18n/texts';
  import { invoke } from '$lib/ipc/api';
  import type { OpenTarget } from '$lib/ipc/types';
  import { glideIntoView } from '$lib/motion/scroll';
  import { unfold } from '$lib/motion/transitions';
  import { inPortalOrder } from '$lib/portals';
  import { app } from '$lib/state/app.svelte';
  import { jobs } from '$lib/state/jobs.svelte';
  import { navigation } from '$lib/state/navigation.svelte';
  import { run } from '$lib/state/run.svelte';
  import { tick } from 'svelte';
  import {
    ACTIONS,
    SECTIONS,
    ownOnly,
    type Action,
    type ActionId,
    type CommandId,
    type Lock,
    type Row,
  } from './cards';
  import MailboxCard from './MailboxCard.svelte';
  import PortalRow from '../shared/PortalRow.svelte';

  /** A note keeps what happened and says it when it shows. */
  type Feedback = { tone: NoticeTone; text: () => string };

  const cfg = $derived(app.state);
  /** What a locked button asks (null until the state is there). */
  const lock = $derived<Lock | null>(
    cfg === null ? null : { state: cfg, t, running: run.active, busyText: run.busyText },
  );
  /** The mailbox is outside the dry run's own data, and a run holds it. */
  const mailboxLocked = $derived(lock === null ? null : ownOnly(lock));
  /** Every portal: the ones the app searches, then the ones of alert mails. */
  const portals = $derived(cfg === null ? [] : inPortalOrder(cfg.portals));
  let busy = $state<CommandId | null>(null);
  /** The note at the end of each card, by section id. */
  let notes = $state<Record<string, Feedback | null>>({});
  let confirmReset = $state(false);
  let resetError = $state<(() => string) | null>(null);

  const note = (section: string, feedback: Feedback | null): void => {
    notes[section] = feedback;
  };

  function open(section: string, target: OpenTarget): void {
    note(section, null);
    invoke('open_target', { target }).catch((error: unknown) =>
      note(section, { tone: 'danger', text: () => errorText(error) }),
    );
  }

  /** On success the app restarts with the setup; a failure stays in the dialog, which tries
   *  again. */
  async function reset(): Promise<void> {
    busy = 'reset';
    resetError = null;
    try {
      await invoke('reset_all');
      confirmReset = false;
    } catch (error) {
      resetError = () => errorText(error);
    } finally {
      busy = null;
    }
  }

  function act(section: string, id: ActionId): void {
    const action: Action = ACTIONS[id];
    if (action.open !== undefined) {
      open(section, action.open);
      return;
    }
    resetError = null;
    confirmReset = true;
  }

  const testidOf = (id: string): string => id.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

  /**
   * Einstellungen opened for one portal from a job (the reader's "Anmeldung einrichten",
   * `navigation.focusPortal`, read once and set back): its row glides into view, its sign-in
   * button (else its switch) takes the focus, and a link leads back to the job, which stays
   * open in Jobs.
   */
  let root = $state<HTMLElement | null>(null);
  let fromJob = $state(false);
  const backToJob = $derived(fromJob && jobs.selected !== null);

  /** Back to the job: the way is spent (a quick return may find this page still fading out,
   *  and it opens as the plain page). The job's row takes the focus once the list is back,
   *  as when the reader closes, so the keys go on from the job. */
  function goBackToJob(): void {
    const open = jobs.selected;
    fromJob = false;
    navigation.go('jobs', false, () => {
      if (open !== null) void tick().then(() => jobs.reach(open, true));
    });
  }
  $effect(() => {
    const portal = navigation.focusPortal;
    if (portal === null || root === null || cfg === null) return;
    navigation.focusPortal = null;
    fromJob = jobs.selected !== null;
    const scope = root;
    void tick().then(() => {
      const row = scope.querySelector(`[data-testid="portal-${portal}"]`);
      if (row === null) return;
      glideIntoView(row, 'center');
      const target =
        row.querySelector<HTMLElement>(
          `[data-testid="sign-in-${portal}"], [data-testid="sign-out-${portal}"]`,
        ) ?? row.querySelector<HTMLElement>(`#switch-enabled-${portal}`);
      target?.focus({ preventScroll: true });
    });
  });
</script>

{#snippet row(section: string, item: Row)}
  {#if cfg !== null && lock !== null}
    <SettingRow hint={item.text(t, cfg)} testid={item.id}>
      {#each item.actions as id (id)}
        {@const action: Action = ACTIONS[id]}
        {@const locked = action.locked?.(lock) ?? null}
        <Button
          variant="secondary"
          icon={action.icon}
          label={action.label(t, cfg)}
          loading={busy === id}
          disabled={locked !== null}
          disabledReason={locked}
          warns={action.warns ?? false}
          testid={testidOf(id)}
          onclick={() => act(section, id)}
        />
      {/each}
    </SettingRow>
  {/if}
{/snippet}

<!-- The note at the end of a card unfolds, so the cards below glide down. The card's inset
     for what is not a row (Card) would jump at once: the note takes its own (a wrapper
     without a box of its own, `.slot`, keeps the card's margin off the folding box). -->
{#snippet noteOf(section: string, feedback: Feedback)}
  <div class="slot">
    <div class="fold" transition:unfold>
      <div class="note">
        <Notice
          tone={feedback.tone}
          variant="inline"
          text={feedback.text()}
          testid="{section}-note"
        />
      </div>
    </div>
  </div>
{/snippet}

<div class="page" data-testid="settings" bind:this={root}>
  <PageHeader
    heading={t.settings.title}
    headingTestid="settings-heading"
    column="page"
    testid="settings-head"
  >
    {#snippet actions()}
      {#if backToJob}
        <Button
          variant="ghost"
          icon="back"
          label={t.settings.backToJob}
          testid="back-to-job"
          onclick={goBackToJob}
        />
      {/if}
    {/snippet}
  </PageHeader>
  <div class="body">
    {#if cfg === null}
      {#if app.slow}
        <Card
          ><div class="skeleton">
            <Skeleton width={40} /><Skeleton /><Skeleton width={70} />
          </div></Card
        >
      {/if}
    {:else}
      {#if cfg.dryRun}
        <Notice tone="info" text={t.settings.dryRun} />
      {/if}
      {#each SECTIONS as section (section.id)}
        {@const feedback = notes[section.id] ?? null}
        <Section
          id="settings-{section.id}"
          name={section.id}
          heading={section.heading(t, cfg)}
          testid="settings-{section.id}"
          cardTestid="card-{section.id}"
        >
          {#if section.block === 'portals'}
            {#each portals as portal (portal.portal)}<PortalRow {portal} />{/each}
          {:else if section.block === 'mailbox'}
            <MailboxCard {cfg} locked={mailboxLocked} />
          {/if}
          {#each section.rows as item (item.id)}{@render row(section.id, item)}{/each}
          {#if feedback}{@render noteOf(section.id, feedback)}{/if}
        </Section>
      {/each}
    {/if}
  </div>
</div>

<Dialog
  bind:open={confirmReset}
  variant="danger"
  heading={t.settings.resetHeading}
  text={t.settings.resetText}
  confirmLabel={t.settings.resetConfirm}
  busy={busy === 'reset'}
  error={resetError?.() ?? null}
  testid="dialog-reset"
  onconfirm={() => void reset()}
/>

<style>
  .page {
    min-height: 100%;
  }

  /* The column under the head: 640 wide, centred, the sections 24 apart. */
  .body {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: var(--space-24);
    max-width: calc(var(--page-width) + 2 * var(--pane-padding));
    margin: 0 auto;
    padding: var(--space-20) var(--pane-padding) var(--page-end);
  }

  .slot {
    display: contents;
  }

  .fold {
    display: flex;
    flex-direction: column;
  }

  .note {
    display: flex;
    padding-block: var(--space-12);
  }

  .skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
  }
</style>
