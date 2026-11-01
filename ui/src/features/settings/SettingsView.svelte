<!--
  Einstellungen (the round 10 draft): the page's head "Einstellungen" and its groups (Section)
  in the order of cards.ts, each with its title and its white box: Jobportale (all ten
  portals in two boxes under their captions, the eight the app searches, then LinkedIn and
  freelance.de; PortalRow), Postfach (MailboxCard, its form unfolds in its box) and Daten
  (the Profil-Ordner and "Alles zurücksetzen", each one sentence and its buttons). Every row
  is a SettingRow with a hairline between rows; every text button of a row is the same
  outlined button with its glyph. This file only renders the list and runs its commands;
  what a row is, says and does is one entry in cards.ts. The page is there at once when it
  opens.

  A switch moves at once (the state is patched before the save) and is its own answer.
  Errors stay a note at the end of their group, which unfolds (the groups below glide down
  instead of jumping). Only "Zurücksetzen" and "Entfernen" of the mailbox ask first; a dialog
  whose action fails stays open and says why inside. The dry run changes nothing and says so
  in a state box above the groups; a run holds the mailbox and the reset, locked with the
  reason of that run instead of failing. Opened for one of its groups (`navigation.section`:
  "Postfach prüfen" of a failed fetch) the page glides to that group.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import Dialog from '$components/Dialog.svelte';
  import Notice, { type NoticeTone } from '$components/Notice.svelte';
  import StateBox from '$components/StateBox.svelte';
  import Group from '$components/Group.svelte';
  import PageHeader from '$components/PageHeader.svelte';
  import Page from '$components/Page.svelte';
  import Section from '$components/Section.svelte';
  import SettingRow from '$components/SettingRow.svelte';
  import Skeleton from '$components/Skeleton.svelte';
  import { t } from '$lib/i18n/t';
  import { errorText } from '$lib/i18n/texts';
  import { invoke } from '$lib/ipc/api';
  import type { OpenTarget, Way } from '$lib/ipc/types';
  import { washOver } from '$lib/motion/arrive';
  import { glideIntoView } from '$lib/motion/scroll';
  import { unfold } from '$lib/motion/transitions';
  import { inPortalOrder } from '$lib/portals';
  import { app } from '$lib/state/app.svelte';
  import { forgetKept } from '$lib/state/listChoices';
  import { navigation } from '$lib/state/navigation.svelte';
  import { run } from '$lib/state/run.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import { tick } from 'svelte';
  import {
    ACTIONS,
    SECTIONS,
    ownOnly,
    type Action,
    type ActionId,
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
  /** The two groups of portals: the ones the app searches (and reads alert mails of), then
   *  the ones of alert mails only. */
  const WAYS: readonly Way[] = ['search', 'alert'];
  /** Every portal, in the UI's order (lib/portals.ts). */
  const portals = $derived(cfg === null ? [] : inPortalOrder(cfg.portals));
  /** The folder dialog is open: its row's button turns meanwhile. */
  let choosing = $state(false);
  /** The note at the end of each card, by section id. */
  let notes = $state<Record<string, Feedback | null>>({});
  let confirmReset = $state(false);
  let resetting = $state(false);
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
   *  again. The restart can come before the answer, so what the page keeps goes first: a refused
   *  reset costs only those choices. */
  async function reset(): Promise<void> {
    resetting = true;
    resetError = null;
    forgetKept();
    try {
      await invoke('reset_all');
      confirmReset = false;
    } catch (error) {
      resetError = () => errorText(error);
    } finally {
      resetting = false;
    }
  }

  /** Another folder for the profile (the folder dialog): it comes along, or the folder's
   *  own is used; the toast says which. */
  async function pickFolder(section: string): Promise<void> {
    note(section, null);
    choosing = true;
    try {
      const picked = await invoke('pick_workspace');
      if (picked === null) return;
      await app.load();
      if (picked.profile === 'own') toasts.show(t.settings.folderOwnProfile, 'info');
      else if (picked.profile === 'copied') toasts.show(t.settings.folderMoved);
      else toasts.show(t.settings.folderFiles);
    } catch (error) {
      note(section, { tone: 'danger', text: () => errorText(error) });
    } finally {
      choosing = false;
    }
  }

  function act(section: string, id: ActionId): void {
    const action: Action = ACTIONS[id];
    if (action.open !== undefined) {
      open(section, action.open);
      return;
    }
    if (id === 'folderChange') {
      void pickFolder(section);
      return;
    }
    resetError = null;
    confirmReset = true;
  }

  const testidOf = (id: string): string => id.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

  /** Einstellungen opened for one of its groups (`navigation.section`, read once and set
   *  back): the group glides into view and its row takes a moment's wash. */
  let root = $state<HTMLElement | null>(null);

  $effect(() => {
    const section = navigation.section;
    if (section === null || root === null || cfg === null) return;
    navigation.section = null;
    const scope = root;
    void tick().then(() => {
      const group = scope.querySelector(`[data-section="${section}"]`);
      if (group === null) return;
      glideIntoView(group, 'center');
      washOver(group);
    });
  });
</script>

{#snippet row(section: string, item: Row)}
  {#if cfg !== null && lock !== null}
    <SettingRow
      label={item.label(t, cfg)}
      hint={item.path?.(t, cfg) ?? item.hint?.(t, cfg) ?? null}
      copy={item.path !== undefined}
      pair={item.actions.length > 1}
      testid={item.id}
    >
      {#each item.actions as id (id)}
        {@const action: Action = ACTIONS[id]}
        {@const locked = action.locked?.(lock) ?? null}
        <Button
          variant="secondary"
          icon={action.icon}
          label={action.label(t, cfg)}
          loading={id === 'folderChange' && choosing}
          disabled={locked !== null}
          disabledReason={locked}
          testid={testidOf(id)}
          onclick={() => act(section, id)}
        />
      {/each}
    </SettingRow>
  {/if}
{/snippet}

<!-- The note at the end of a section unfolds, so the sections below glide down. -->
{#snippet noteOf(section: string, feedback: Feedback)}
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
{/snippet}

{#snippet head()}
  <PageHeader
    heading={t.nav.settings}
    headingTestid="settings-heading"
    column="page"
    testid="settings-head"
  />
{/snippet}

<Page testid="settings" bind:element={root} {head}>
  {#if cfg === null}
    {#if app.slow}
      <div class="skeleton">
        <Skeleton width={40} /><Skeleton /><Skeleton width={70} />
      </div>
    {/if}
  {:else}
    <div class="groups">
      {#if cfg.dryRun}
        <StateBox heading={t.settings.dryRun} testid="dry-run-note" />
      {/if}
      {#each SECTIONS as section (section.id)}
        {@const feedback = notes[section.id] ?? null}
        <div class="group">
          <Section
            id="settings-{section.id}"
            name={section.id}
            heading={section.heading(t, cfg)}
            testid="settings-{section.id}"
          >
            {#if section.block === 'portals'}
              {#each WAYS as way (way)}
                <Group caption={t.settings.way[way]} captionTestid="portals-{way}">
                  {#each portals.filter((p) => p.way === way) as portal (portal.portal)}
                    <PortalRow {portal} />
                  {/each}
                </Group>
              {/each}
            {:else}
              <Group rows>
                {#if section.block === 'mailbox'}
                  <MailboxCard {cfg} locked={mailboxLocked} />
                {/if}
                {#each section.rows as item (item.id)}{@render row(section.id, item)}{/each}
                {#if feedback}{@render noteOf(section.id, feedback)}{/if}
              </Group>
            {/if}
          </Section>
        </div>
      {/each}
    </div>
  {/if}
</Page>

<Dialog
  bind:open={confirmReset}
  variant="danger"
  heading={t.settings.resetHeading}
  text={t.settings.resetText}
  confirmLabel={t.settings.resetAction}
  busy={resetting}
  error={resetError?.() ?? null}
  testid="dialog-reset"
  onconfirm={() => void reset()}
/>

<style>
  .groups {
    display: flex;
    flex-direction: column;
    gap: var(--group-section-gap);
  }

  .group {
    display: flex;
    flex-direction: column;
  }

  .fold {
    display: flex;
    flex-direction: column;
  }

  /* In a box of rows, which has no padding of its own: on the rows' left edge. */
  .note {
    display: flex;
    padding: 0 var(--card-pad-x) var(--space-12) var(--setting-rule-start);
  }

  .skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
  }
</style>
