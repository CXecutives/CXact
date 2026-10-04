<!--
  Einstellungen (centred 720): the tabs Portale and Daten (user, 2026-10-03), each with its
  cards of cards.ts. Portale: "CXact sucht nach" (the search's terms, SearchTerms, with an
  info symbol), "Jobportale" (the portals the app searches, PortalRow), "Alert-Mails" (the
  mailbox card on top, without a mailbox "Ohne Postfach ruhen LinkedIn und freelance.de.",
  then the portals of alert mails). Daten: the profiles' folder, the reset, a quiet line with
  the version. Every text button of a row is the same outlined button, and every row ends on
  the card's inner edge. This file only renders the list and runs its commands; what a row
  is, says and does is one entry in cards.ts.

  A switch moves at once (the state is patched before the save) and is its own answer.
  Errors stay a note at the end of their card, which unfolds (the cards below glide down
  instead of jumping). Only "Zurücksetzen" and "Entfernen" of the mailbox ask first; a dialog
  whose action fails stays open and says why inside. The dry run changes nothing, and a run
  holds the mailbox and the reset, locked with the reason of that run instead of failing.
  Opened from a job for one portal ("Anmeldung einrichten") the page shows Portale, glides to
  the portal's row, focuses its sign-in and offers "Zurück zum Job" beside the tabs.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import Card from '$components/Card.svelte';
  import Dialog from '$components/Dialog.svelte';
  import InfoTip from '$components/InfoTip.svelte';
  import Notice, { type NoticeTone } from '$components/Notice.svelte';
  import SettingRow from '$components/SettingRow.svelte';
  import Skeleton from '$components/Skeleton.svelte';
  import Tabs, { type TabOption } from '$components/Tabs.svelte';
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
  import { SETTINGS_TABS, settingsTab, type SettingsTab } from '$lib/state/settings.svelte';
  import { tick } from 'svelte';
  import {
    ACTIONS,
    CARDS,
    ownOnly,
    portalsOf,
    type Action,
    type ActionId,
    type CommandId,
    type Lock,
    type Portals,
    type Row,
  } from './cards';
  import MailboxCard from './MailboxCard.svelte';
  import PortalRow from '../shared/PortalRow.svelte';
  import SearchTerms from './SearchTerms.svelte';

  /** A note keeps what happened and says it when it shows. */
  type Feedback = { tone: NoticeTone; text: () => string };

  const cfg = $derived(app.state);
  /** What a locked button asks (null until the state is there). */
  const lock = $derived<Lock | null>(
    cfg === null ? null : { state: cfg, t, running: run.active, busyText: run.busyText },
  );
  /** The mailbox is outside the dry run's own data, and a run holds it. */
  const mailboxLocked = $derived(lock === null ? null : ownOnly(lock));
  const portals = $derived(cfg === null ? [] : inPortalOrder(cfg.portals));
  const portalsIn = (card: Portals) => portals.filter((p) => portalsOf(p.way) === card);
  const tabs = $derived<TabOption<SettingsTab>[]>(
    SETTINGS_TABS.map((tab) => ({
      id: tab,
      label: t.settings[tab],
      testid: `settings-tab-${tab}`,
    })),
  );
  let busy = $state<CommandId | null>(null);
  /** The note at the end of each card, by card id. */
  let notes = $state<Record<string, Feedback | null>>({});
  let confirmReset = $state(false);
  let resetError = $state<(() => string) | null>(null);

  const note = (card: string, feedback: Feedback | null): void => {
    notes[card] = feedback;
  };

  function open(card: string, target: OpenTarget): void {
    note(card, null);
    invoke('open_target', { target }).catch((error: unknown) =>
      note(card, { tone: 'danger', text: () => errorText(error) }),
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

  function act(card: string, id: ActionId): void {
    const action: Action = ACTIONS[id];
    if (action.open !== undefined) {
      open(card, action.open);
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
    settingsTab.value = 'portals';
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

{#snippet row(card: string, item: Row)}
  {#if cfg !== null && lock !== null}
    <SettingRow label={item.label(t, cfg)} testid={item.id}>
      <div class="buttons">
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
            onclick={() => act(card, id)}
          />
        {/each}
      </div>
    </SettingRow>
  {/if}
{/snippet}

<!-- The note at the end of a card unfolds, so the cards below glide down. The card's inset
     for what is not a row (Card) would jump at once: the note takes its own (a wrapper
     without a box of its own, `.slot`, keeps the card's margin off the folding box). -->
{#snippet noteOf(card: string, feedback: Feedback)}
  <div class="slot">
    <div class="fold" transition:unfold>
      <div class="note">
        <Notice tone={feedback.tone} variant="inline" text={feedback.text()} testid="{card}-note" />
      </div>
    </div>
  </div>
{/snippet}

<div class="page" data-testid="settings" bind:this={root}>
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

    <div class="tabbar" data-first-row>
      <Tabs
        options={tabs}
        value={settingsTab.value}
        label={t.settings.tabs}
        testid="settings-tabs"
        onchange={(tab) => (settingsTab.value = tab)}
      />
      {#if backToJob}
        <Button
          variant="link"
          label={t.settings.backToJob}
          testid="back-to-job"
          onclick={goBackToJob}
        />
      {/if}
    </div>
    {#each SETTINGS_TABS as tab (tab)}
      <div
        class="panel"
        class:gone={tab !== settingsTab.value}
        role="tabpanel"
        aria-label={t.settings[tab]}
        data-testid="settings-panel-{tab}"
      >
        {#each CARDS.filter((card) => card.tab === tab) as card (card.id)}
          {@const feedback = notes[card.id] ?? null}
          {@const heading = card.heading?.(t, cfg) ?? null}
          <section
            class="section"
            aria-label={heading ?? t.settings[tab]}
            data-testid="settings-{card.id}"
          >
            {#if heading}
              <h2 class="heading">
                {heading}
                {#if card.info}
                  <InfoTip
                    text={card.info(t, cfg)}
                    label={t.common.infoAbout(heading)}
                    testid="info-{card.id}"
                  />
                {/if}
              </h2>
            {/if}
            {#if card.block === 'terms'}
              <SearchTerms />
            {:else}
              {#if card.block === 'mailbox'}
                <MailboxCard {cfg} locked={mailboxLocked} testid="mailbox-account" />
              {/if}
              <Card padding="rows" testid={card.block ? `portals-${card.block}` : null}>
                {#each card.rows as item (item.id)}{@render row(card.id, item)}{/each}
                {#if card.block}
                  {#each portalsIn(card.block) as portal (portal.portal)}
                    <PortalRow {portal} />
                  {/each}
                {/if}
                {#if feedback}{@render noteOf(card.id, feedback)}{/if}
              </Card>
            {/if}
            {#if card.footnote}
              <p class="footnote" data-testid="{card.id}-footnote">{card.footnote(t, cfg)}</p>
            {/if}
          </section>
        {/each}
      </div>
    {/each}
  {/if}
</div>

<Dialog
  bind:open={confirmReset}
  variant="danger"
  heading={t.settings.resetHeading}
  text={t.settings.resetText}
  confirmLabel={t.settings.resetAction}
  busy={busy === 'reset'}
  error={resetError?.() ?? null}
  testid="dialog-reset"
  onconfirm={() => void reset()}
/>

<style>
  .page {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: var(--space-24);
    max-width: calc(var(--reader-width) + 2 * var(--pane-padding));
    margin: 0 auto;
    padding: var(--pane-padding) var(--pane-padding) var(--page-end);
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
  }

  /* The heading of a card, an info symbol beside it where it has one. */
  .heading {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    color: var(--text-heading);
    font: var(--type-lg);
  }

  /* The tabs on the first row of the window (base.css), at their end the way back to the
     job she came from; 24 above the first card, like the Profil's. */
  .tabbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-12);
  }

  /* The cards of a tab 32 apart, like the Profil's sections. */
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-32);
  }

  .panel.gone {
    display: none;
  }

  /* The buttons of a row end on its trailing edge, 12 apart, one size (28, outlined). */
  .buttons {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-12);
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

  /* The version, quietly under the card. */
  .footnote {
    color: var(--text-subtle);
    font: var(--type-sm);
    font-variant-numeric: var(--numeric);
  }

  .skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
  }
</style>
