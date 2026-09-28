<!--
  Einstellungen (centred 720): the cards of cards.ts in their order (Postfach, Portale,
  Export, Darstellung, Daten), each a heading 12 px above a card of setting rows (Postfach
  and Portale are a block of their own). Every text button of a row is the same outlined button, and every row ends on
  the card's inner edge (its buttons, switch or choice flush with the rows above and
  below). This file only renders the list and runs its commands; what a row is, says and does
  is one entry in cards.ts.

  A switch or a choice moves at once (the state is patched before the save) and is its own
  answer; Darstellung switches the colours and the language of the whole app at once, and
  the backend follows with the window and the files. A success that shows nowhere else is a
  toast (another export folder); errors and warnings stay a note at the end of their card,
  which unfolds (the cards below glide down instead of jumping).
  Only "Zurücksetzen", "Entfernen" of the mailbox and the restore of a backup
  (BackupDialog.svelte) ask first; a dialog whose action fails stays open and says why
  inside. The dry run changes nothing, and a run (a fetch, or the rescore after a profile
  change) holds the mailbox, the folder and the files, so what they cannot do is locked with
  the reason of that run instead of failing. The demo keeps to its own folders: mailbox,
  export folder and reset are locked with its reason. Opened from a job for one portal
  ("Anmeldung einrichten") the page glides to that portal's row, focuses its sign-in, lets
  the row light up once and offers "Zurück zum Job".
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import Card from '$components/Card.svelte';
  import Dialog from '$components/Dialog.svelte';
  import Notice, { type NoticeTone } from '$components/Notice.svelte';
  import Segmented from '$components/Segmented.svelte';
  import SettingRow from '$components/SettingRow.svelte';
  import Skeleton from '$components/Skeleton.svelte';
  import Toggle from '$components/Toggle.svelte';
  import { t } from '$lib/i18n/t';
  import { errorText } from '$lib/i18n/texts';
  import { invoke } from '$lib/ipc/api';
  import type { OpenTarget, SettingsPatch } from '$lib/ipc/types';
  import { crossfadeDuration, duration } from '$lib/motion/motion';
  import { glideIntoView } from '$lib/motion/scroll';
  import { unfold } from '$lib/motion/transitions';
  import { inPortalOrder } from '$lib/portals';
  import { app } from '$lib/state/app.svelte';
  import { jobs } from '$lib/state/jobs.svelte';
  import { navigation } from '$lib/state/navigation.svelte';
  import { run } from '$lib/state/run.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import { tick } from 'svelte';
  import {
    ACTIONS,
    CARDS,
    settingsPatch,
    type Action,
    type ActionId,
    type ChoiceRow,
    type CommandId,
    type Lock,
    type Row,
    type Switch,
  } from './cards';
  import MailboxCard from './MailboxCard.svelte';
  import PortalRow from './PortalRow.svelte';

  /** A note keeps what happened and says it when it shows, so it follows a switch of the
   *  language (a sentence made at once would stay in the old one). */
  type Feedback = { tone: NoticeTone; text: () => string };

  const cfg = $derived(app.state);
  /** What a locked button asks (null until the state is there). */
  const lock = $derived<Lock | null>(
    cfg === null ? null : { state: cfg, t, running: run.active, busyText: run.busyText },
  );
  /** The mailbox is outside the demo's and the dry run's own data, and a run holds it. */
  const mailboxLocked = $derived(lock === null ? null : ACTIONS.folderChange.locked(lock));
  const portals = $derived(cfg === null ? [] : inPortalOrder(cfg.portals));
  let busy = $state<CommandId | null>(null);
  /** The note at the end of each card, by card id. */
  let notes = $state<Record<string, Feedback | null>>({});
  let confirmReset = $state(false);
  let resetError = $state<(() => string) | null>(null);
  /** Only the answer to the latest save may replace the state (quick double flips). */
  let saves = 0;

  const note = (card: string, feedback: Feedback | null): void => {
    notes[card] = feedback;
  };
  const failed = (card: string, error: unknown): void =>
    note(card, { tone: 'danger', text: () => errorText(error) });

  /** A switch or a choice: the page follows at once, the save after; a failure loads the
   *  stored state again (switch, colours and language go back) and says why in its card. */
  async function save(card: string, change: Partial<SettingsPatch>): Promise<void> {
    const mine = ++saves;
    note(card, null);
    try {
      const next = await invoke('save_settings', { patch: settingsPatch(change) });
      if (mine === saves) app.set(next);
    } catch (error) {
      failed(card, error);
      void app.load();
    }
  }

  function flip(card: string, toggle: Switch, on: boolean): Promise<void> {
    if (cfg === null) return Promise.resolve();
    toggle.set(cfg, on);
    return save(card, toggle.patch(on));
  }

  function choose<Id extends string>(card: string, row: ChoiceRow<Id>, id: Id): void {
    if (cfg === null) return;
    row.set(cfg, id);
    // The language and the colours of the whole page follow the state at once.
    app.set(cfg);
    void save(card, row.patch(id));
  }

  function open(card: string, target: OpenTarget): void {
    note(card, null);
    invoke('open_target', { target }).catch((error: unknown) => failed(card, error));
  }

  /** Runs a command of a card: its failure is said in the card, its success by the command. */
  async function command(card: string, id: CommandId, work: () => Promise<void>): Promise<void> {
    busy = id;
    note(card, null);
    try {
      await work();
    } catch (error) {
      failed(card, error);
    } finally {
      busy = null;
    }
  }

  /** Another export folder: the profile comes along (or the folder's own is used) and the
   *  files are written there at once (pick_workspace); the toast says which. */
  const pickFolder = (card: string): Promise<void> =>
    command(card, 'folderChange', async () => {
      const picked = await invoke('pick_workspace');
      if (picked === null) return;
      await app.load();
      if (picked.profile === 'own') toasts.show(t.settings.folderOwnProfile, 'info');
      else if (picked.profile === 'copied') toasts.show(t.settings.folderMoved);
      else toasts.show(t.settings.folderFiles);
    });

  /** On success the app restarts empty; a failure stays in the dialog, which tries again. */
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
    const commands: Record<CommandId, () => void> = {
      folderChange: () => void pickFolder(card),
      reset: () => {
        resetError = null;
        confirmReset = true;
      },
    };
    commands[id as CommandId]();
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
      flash(row);
    });
  });

  /** The row a job asked for lights up once when the glide ends and settles (like a passage
   *  of the ad after a jump): `data-flash` on, off, gone. */
  function flash(row: Element): void {
    setTimeout(() => {
      row.setAttribute('data-flash', 'on');
      setTimeout(
        () => {
          row.setAttribute('data-flash', 'off');
          setTimeout(() => row.removeAttribute('data-flash'), duration('base'));
        },
        duration('reveal') || crossfadeDuration(),
      );
    }, duration('slow'));
  }
</script>

{#snippet row(card: string, item: Row)}
  {#if cfg !== null && lock !== null}
    {#if item.kind === 'choice'}
      {@const choice = item as ChoiceRow}
      <SettingRow label={choice.label(t, cfg)} testid="row-{choice.id}">
        <Segmented
          options={choice.options.map((id) => ({ id, label: choice.name(t, id) }))}
          value={choice.value(cfg)}
          label={choice.label(t, cfg)}
          testid={choice.id}
          onchange={(id) => choose(card, choice, id)}
        />
      </SettingRow>
    {:else}
      {@const toggle = item.toggle ?? null}
      <SettingRow
        label={item.label(t, cfg)}
        hint={item.path?.(cfg) ?? null}
        copy={item.path !== undefined}
        for={toggle === null ? null : `switch-${toggle.id}`}
        testid={item.id}
      >
        <div class="buttons">
          {#each item.actions as id (id)}
            {@const action: Action = ACTIONS[id]}
            {@const locked = action.locked?.(lock) ?? null}
            <Button
              variant="secondary"
              size="sm"
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
          {#if toggle}
            <Toggle
              id="switch-{toggle.id}"
              checked={toggle.on(cfg)}
              label={item.label(t, cfg)}
              testid="toggle-{toggle.id}"
              onchange={(on) => flip(card, toggle, on)}
            />
          {/if}
        </div>
      </SettingRow>
    {/if}
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
    {:else if cfg.demo}
      <Notice tone="info" text={t.settings.demo} testid="demo-note" />
    {/if}

    {#each CARDS.filter((card) => !card.hidden) as card, index (card.id)}
      {@const feedback = notes[card.id] ?? null}
      <section class="section" data-testid="settings-{card.id}">
        <div class="title" data-first-row={index === 0 ? '' : undefined}>
          <h2 class="heading">{card.heading(t, cfg)}</h2>
          {#if card.block === 'portals' && backToJob}
            <Button
              variant="link"
              size="sm"
              label={t.settings.backToJob}
              testid="back-to-job"
              onclick={goBackToJob}
            />
          {/if}
        </div>
        {#if card.block === 'mailbox'}
          <MailboxCard {cfg} locked={mailboxLocked}>
            {#each card.rows as item (item.id)}{@render row(card.id, item)}{/each}
            {#if feedback}{@render noteOf(card.id, feedback)}{/if}
          </MailboxCard>
        {:else}
          <Card padding="rows" testid={card.block === 'portals' ? 'portals' : null}>
            {#if card.block === 'portals'}
              {#each portals as portal (portal.portal)}<PortalRow {portal} />{/each}
            {/if}
            {#each card.rows as item (item.id)}{@render row(card.id, item)}{/each}
            {#if feedback}{@render noteOf(card.id, feedback)}{/if}
          </Card>
        {/if}
      </section>
    {/each}
  {/if}
</div>

<Dialog
  bind:open={confirmReset}
  variant="danger"
  heading={t.settings.resetHeading}
  text={t.settings.resetText}
  items={t.settings.resetItems}
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
    gap: var(--space-32);
    max-width: calc(var(--reader-width) + 2 * var(--pane-padding));
    margin: 0 auto;
    padding: var(--pane-padding) var(--pane-padding) var(--page-end);
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
  }

  /* The portal row a job asked for ("Anmeldung einrichten"): a soft tint for a moment. */
  .page :global([data-flash]) {
    transition: background-color var(--dur-base) var(--ease-standard);
  }

  .page :global([data-flash='on']) {
    background-color: var(--info-soft);
    transition-duration: var(--dur-hover);
  }

  /* The heading, and at its end the way back to the job she came from. */
  .title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-12);
  }

  /* The first heading is centred on the first row of the window (base.css); it takes back
     what that row adds below its line, so every heading stands 12 px above its card. */
  .title[data-first-row] {
    margin-bottom: calc((var(--leading-lg) - var(--first-row)) / 2);
  }

  .heading {
    color: var(--text-heading);
    font: var(--type-lg);
  }

  /* The buttons of a row end on its trailing edge, 12 apart, one size (28, outlined); a
     switch after them. */
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

  .skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
  }
</style>
