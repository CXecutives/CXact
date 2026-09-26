<!--
  Einstellungen (centred 720): the cards of cards.ts in their order, each a heading and a
  card of setting rows (Postfach, Portale and Tastenkürzel are blocks of their own), and
  "Alles zurücksetzen" alone on the last card. This file only renders the list and runs its
  commands; what a row is, says and does is one entry in cards.ts.

  A switch or a choice moves at once (the state is patched before the save) and is its own
  answer; Darstellung switches the colours and the language of the whole app at once, and
  the backend follows with the window and the files. A success that shows nowhere else is a
  toast (files written or deleted, another work folder); errors and warnings stay a note at
  the end of their card. Only "Alles zurücksetzen", "Postfach entfernen" and a restore of a
  backup ask first; a dialog whose action fails stays open and says why inside. "Sicherung
  wiederherstellen" lists the copies by day, asks with the copy's date and restores; the
  whole page loads again and a toast offers the undo (the copy of the state it replaced). The dry run changes nothing, and
  a run (a fetch, or the rescore after a profile change) holds the mailbox, the folder and
  the files, so what they cannot do is locked with the reason of that run instead of
  failing. The demo keeps to its own folders: mailbox, work folder and reset are locked with
  its reason. Opened from a job for one portal ("Anmeldung einrichten") the page glides to
  that portal's card, focuses its sign-in and offers "Zurück zum Job".
-->
<script lang="ts">
  import Badge from '$components/Badge.svelte';
  import Button from '$components/Button.svelte';
  import Card from '$components/Card.svelte';
  import Dialog from '$components/Dialog.svelte';
  import Notice, { type NoticeTone } from '$components/Notice.svelte';
  import RadioList from '$components/RadioList.svelte';
  import Segmented from '$components/Segmented.svelte';
  import SettingRow from '$components/SettingRow.svelte';
  import Skeleton from '$components/Skeleton.svelte';
  import Toggle from '$components/Toggle.svelte';
  import { formatBytes, formatDate, formatDayTime, formatTime } from '$lib/i18n/format';
  import { t } from '$lib/i18n/t';
  import { errorText } from '$lib/i18n/texts';
  import { invoke } from '$lib/ipc/api';
  import type { Backup, OpenTarget, SettingsPatch } from '$lib/ipc/types';
  import { glideIntoView } from '$lib/motion/scroll';
  import { app } from '$lib/state/app.svelte';
  import { clock } from '$lib/state/clock.svelte';
  import { jobs } from '$lib/state/jobs.svelte';
  import { navigation } from '$lib/state/navigation.svelte';
  import { run } from '$lib/state/run.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import { tick } from 'svelte';
  import KeyList from '../shared/KeyList.svelte';
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
    type SwitchRow,
  } from './cards';
  import MailboxCard from './MailboxCard.svelte';
  import PortalCard from './PortalCard.svelte';

  /** A note keeps what happened and says it when it shows, so it follows a switch of the
   *  language (a sentence made at once would stay in the old one). */
  type Feedback = { tone: NoticeTone; text: () => string };

  const cfg = $derived(app.state);
  /** What a locked button asks (null until the state is there). */
  const lock = $derived<Lock | null>(
    cfg === null
      ? null
      : {
          state: cfg,
          t,
          running: run.active,
          busyText: run.busyText,
          beforeFirstFetch: cfg.lastRun === null,
        },
  );
  /** The mailbox is outside the demo's and the dry run's own data, and a run holds it. */
  const mailboxLocked = $derived(lock === null ? null : ACTIONS.workspaceChange.locked(lock));
  let busy = $state<CommandId | null>(null);
  /** The note at the end of each card, by card id. */
  let notes = $state<Record<string, Feedback | null>>({});
  let confirmReset = $state(false);
  let resetError = $state<(() => string) | null>(null);
  /** "Sicherung wiederherstellen": its dialog, the copies, the chosen one, whether the
   *  question before the restore shows, and why the restore failed. */
  let backupOpen = $state(false);
  let backups = $state.raw<Backup[]>([]);
  let chosenBackup = $state<string | null>(null);
  let confirmBackup = $state(false);
  let backupError = $state<(() => string) | null>(null);
  const chosen = $derived(backups.find((backup) => backup.id === chosenBackup) ?? null);
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

  function flip(card: string, row: SwitchRow, on: boolean): void {
    if (cfg === null) return;
    row.set(cfg, on);
    void save(card, row.patch(on));
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

  /** Another work folder: the profile comes along (or the folder's own is used) and the
   *  files are written there at once (pick_workspace); the toast says which. */
  const pickWorkspace = (card: string): Promise<void> =>
    command(card, 'workspaceChange', async () => {
      const picked = await invoke('pick_workspace');
      if (picked === null) return;
      await app.load();
      if (picked.profile === 'own') toasts.show(t.settings.workspaceOwnProfile, 'info');
      else if (picked.profile === 'copied') toasts.show(t.settings.workspaceMoved);
      else toasts.show(t.settings.workspaceFiles);
    });

  /** Writes the text files again; a file another program holds open stays a note. */
  async function writeTxt(card: string): Promise<boolean> {
    const { error, txtFailed, txtWritten } = await invoke('rewrite_txt');
    await app.load();
    if (error) {
      note(card, { tone: 'danger', text: () => t.error.text(error.kind, error.params) });
      return false;
    }
    if (txtFailed > 0) {
      note(card, { tone: 'warning', text: () => t.settings.txtFailed(txtFailed) });
      return false;
    }
    return txtWritten > 0;
  }

  const rewrite = (card: string): Promise<void> =>
    command(card, 'txtRewrite', async () => {
      if (await writeTxt(card)) toasts.show(t.settings.txtRewritten);
      else if (notes[card] === null || notes[card] === undefined) {
        toasts.show(t.settings.txtNothing, 'info');
      }
    });

  /** Deletes the text files; the toast's undo writes them again. */
  const clear = (card: string): Promise<void> =>
    command(card, 'txtClear', async () => {
      const { failed: open } = await invoke('clear_txt');
      await app.load();
      if (open.length > 0) {
        note(card, { tone: 'warning', text: () => t.settings.txtFailed(open.length) });
        return;
      }
      toasts.show(t.settings.txtCleared, 'success', {
        label: t.common.undo,
        onclick: () => void command(card, 'txtRewrite', async () => void (await writeTxt(card))),
      });
    });

  /** The copies, newest first and chosen, in the dialog; none is a note in the card. */
  const openBackups = (card: string): Promise<void> =>
    command(card, 'backupRestore', async () => {
      const found = await invoke('list_backups');
      if (found.length === 0) {
        note(card, { tone: 'info', text: () => t.settings.backupNone });
        return;
      }
      backups = found;
      chosenBackup = found[0]!.id;
      confirmBackup = false;
      backupError = null;
      backupOpen = true;
    });

  /** The database changed under the page: the undos of before go (their jobs may be gone),
   *  the app state, the list and the counts load again. */
  async function reloadAll(): Promise<void> {
    for (const item of [...toasts.items]) toasts.dismiss(item.id);
    await Promise.all([app.load(), jobs.reload()]);
  }

  /** The dialog's button: first the question with the copy's date, then the restore. A
   *  failure stays in the dialog; the toast's undo restores the copy of the state before. */
  async function restoreBackup(card: string): Promise<void> {
    if (chosen === null) return;
    if (!confirmBackup) {
      confirmBackup = true;
      return;
    }
    busy = 'backupRestore';
    backupError = null;
    try {
      const before = await invoke('restore_backup', { id: chosen.id });
      backupOpen = false;
      await reloadAll();
      toasts.show(t.settings.backupRestored, 'success', {
        label: t.common.undo,
        onclick: () => void undoRestore(card, before.id),
      });
    } catch (error) {
      backupError = () => errorText(error);
    } finally {
      busy = null;
    }
  }

  const undoRestore = (card: string, id: string): Promise<void> =>
    command(card, 'backupRestore', async () => {
      await invoke('restore_backup', { id });
      await reloadAll();
      toasts.show(t.settings.backupUndone);
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
      workspaceChange: () => void pickWorkspace(card),
      txtRewrite: () => void rewrite(card),
      txtClear: () => void clear(card),
      backupRestore: () => void openBackups(card),
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
   * `navigation.focusPortal`, read once and set back): its card glides into view, its sign-in
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
      const card = scope.querySelector(`[data-testid="portal-${portal}"]`);
      if (card === null) return;
      glideIntoView(card, 'center');
      const target =
        card.querySelector<HTMLElement>(
          `[data-testid="sign-in-${portal}"], [data-testid="sign-out-${portal}"]`,
        ) ?? card.querySelector<HTMLElement>(`#switch-enabled-${portal}`);
      target?.focus({ preventScroll: true });
    });
  });
</script>

{#snippet row(card: string, item: Row)}
  {#if cfg !== null && lock !== null}
    {#if item.kind === 'switch'}
      <SettingRow
        label={item.label(t, cfg)}
        hint={item.hint(t, cfg)}
        for="switch-{item.id}"
        testid="row-{item.id}"
      >
        <Toggle
          id="switch-{item.id}"
          checked={item.on(cfg)}
          label={item.label(t, cfg)}
          testid="toggle-{item.id}"
          onchange={(on) => flip(card, item, on)}
        />
      </SettingRow>
    {:else if item.kind === 'choice'}
      {@const choice = item as ChoiceRow}
      <SettingRow label={choice.label(t, cfg)} testid="row-{choice.id}">
        <Segmented
          size="sm"
          options={choice.options.map((id) => ({ id, label: choice.name(t, id) }))}
          value={choice.value(cfg)}
          label={choice.label(t, cfg)}
          testid={choice.id}
          onchange={(id) => choose(card, choice, id)}
        />
      </SettingRow>
    {:else if item.kind === 'actions'}
      <SettingRow
        label={item.label(t, cfg)}
        hint={item.hint?.(t, cfg) ?? null}
        copy={item.copy ?? false}
        testid={item.id}
      >
        {#snippet badges()}
          {@const badge = item.badge?.(t, cfg) ?? null}
          {#if badge}<Badge label={badge} />{/if}
        {/snippet}
        <div class="buttons">
          {#each item.actions as id (id)}
            {@const action: Action = ACTIONS[id]}
            {@const locked = action.locked?.(lock) ?? null}
            <Button
              variant={action.variant}
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
        </div>
      </SettingRow>
    {:else}
      <SettingRow label={item.label(t, cfg)} testid={item.id}>
        <span class="value" data-copy>{item.value(cfg)}</span>
      </SettingRow>
    {/if}
  {/if}
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

    {#each CARDS as card, index (card.id)}
      <section class="section" data-testid="settings-{card.id}">
        {#if card.heading}
          <div class="title">
            <div class="title-row" data-first-row={index === 0 ? '' : undefined}>
              <h2 class="heading">{card.heading(t, cfg)}</h2>
              {#if card.body === 'portals' && backToJob}
                <Button
                  variant="link"
                  size="sm"
                  label={t.settings.backToJob}
                  testid="back-to-job"
                  onclick={goBackToJob}
                />
              {/if}
            </div>
            {#if card.hint}
              <p class="hint" data-testid="{card.id}-hint">{card.hint(t, cfg)}</p>
            {/if}
          </div>
        {/if}
        {#if card.body === 'mailbox'}
          <MailboxCard {cfg} locked={mailboxLocked} />
        {:else if card.body === 'portals'}
          {#each cfg.portals as portal (portal.portal)}
            <PortalCard {portal} />
          {/each}
        {:else if card.body === 'keys'}
          <Card padding="md"><KeyList /></Card>
        {:else}
          <Card padding="rows">
            {#each card.body as item (item.id)}
              {@render row(card.id, item)}
            {/each}
            {@const feedback = notes[card.id] ?? null}
            {#if feedback}
              <Notice
                tone={feedback.tone}
                variant="inline"
                text={feedback.text()}
                testid="{card.id}-note"
              />
            {/if}
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

<Dialog
  bind:open={backupOpen}
  heading={confirmBackup && chosen !== null
    ? t.settings.backupConfirm(formatDate(chosen.at), formatTime(chosen.at))
    : t.settings.backup}
  text={confirmBackup ? t.settings.backupConfirmText : null}
  confirmLabel={t.settings.backupAction}
  busy={busy === 'backupRestore'}
  error={backupError?.() ?? null}
  testid="dialog-backup"
  onconfirm={() => void restoreBackup('care')}
>
  {#if !confirmBackup}
    <RadioList
      options={backups.map((backup) => ({
        id: backup.id,
        label: formatDayTime(backup.at, clock.now),
        note: t.settings.backupKind[backup.kind],
        detail: formatBytes(backup.bytes),
      }))}
      value={chosenBackup}
      label={t.settings.backup}
      testid="backup-list"
      onchange={(id) => (chosenBackup = id)}
    />
  {/if}
</Dialog>

<style>
  .page {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: var(--space-32);
    max-width: calc(var(--reader-width) + 2 * var(--pane-padding));
    margin: 0 auto;
    padding: var(--pane-padding) var(--pane-padding) var(--space-64);
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
  }

  .title {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  /* The heading, and at its end the way back to the job she came from. */
  .title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-12);
  }

  .heading {
    color: var(--text-heading);
    font: var(--type-lg);
  }

  .hint {
    color: var(--text-muted);
    font: var(--type-sm);
  }

  /* The buttons of a row end on its trailing edge, 12 apart, one size (28). */
  .buttons {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-12);
  }

  /* The app's version: a value to copy, quiet like the keys. */
  .value {
    color: var(--text-muted);
    font: var(--type-sm);
    font-variant-numeric: var(--numeric);
  }

  .skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
  }
</style>
