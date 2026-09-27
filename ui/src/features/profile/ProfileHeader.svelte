<!--
  The head of the Profil view, on the first row of the window (`data-first-row`): on the left
  a status only when there is one ("n Werte prüfen" while values of the file do not read, a
  click goes to the first one; the rescore a save started), on the right the actions: one
  button (an update from a CV, for a new form one from a CV) and the "…" menu with the rest
  (another file, the profile folder, "Profil löschen" in red, which asks first). The form
  below says who the profile is about, so the head does not repeat it. While the form holds
  changes, what would replace or drop them waits and says "Erst speichern oder verwerfen."
  Under the row, only where it prevents a mistake: keys of the file the app does not read
  (with the folder at hand), that saving a chosen file replaces the profile, and a failure.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import Notice from '$components/Notice.svelte';
  import Spinner from '$components/Spinner.svelte';
  import { t } from '$lib/i18n/t';
  import { warningText } from '$lib/i18n/texts';
  import type { Notice as NoticeData, ProfileInfo } from '$lib/ipc/types';
  import { fade } from '$lib/motion/transitions';
  import { menuState, openMenu, type MenuEntry } from '$lib/state/menu.svelte';
  import type { DraftOrigin } from '$lib/state/profile.svelte';

  interface Props {
    origin: DraftOrigin;
    profile: ProfileInfo | null;
    /** How many values are still to check. */
    checks: number;
    /** Warnings said here: what the form cannot change (keys the app does not read). */
    warnings: readonly NoticeData[];
    rescoring: boolean;
    /** Unsaved changes: another file, an update or a removal would drop them. */
    dirty: boolean;
    /** Saving the draft replaces the stored profile (another file). */
    replacing: boolean;
    picking: boolean;
    note: string | null;
    onpick: () => void;
    onremove: () => void;
    onfromcv: () => void;
    onopenfolder: () => void;
    /** "n Werte prüfen": the caret goes to the first one. */
    oncheck: () => void;
  }

  let {
    origin,
    profile,
    checks,
    warnings,
    rescoring,
    dirty,
    replacing,
    picking,
    note,
    onpick,
    onremove,
    onfromcv,
    onopenfolder,
    oncheck,
  }: Props = $props();

  const stored = $derived(origin === 'stored' && profile !== null);
  /** A new form for a stored file that does not read: saving replaces that file. */
  const replacesBroken = $derived(origin === 'new' && (profile?.parseError ?? null) !== null);
  const notes = $derived(
    warnings.flatMap((notice) => {
      const text = warningText(notice);
      return text === null ? [] : [{ text, folder: notice.code === 'ignoredKeys' }];
    }),
  );
  /** The actions: for the stored profile and a new form (a draft is saved or discarded). */
  const actions = $derived(stored || origin === 'new');

  // ------------------------------------------------------------------ the "…" menu
  let anchor = $state<HTMLElement | null>(null);
  let expanded = $state(false);

  /** What the menu holds: for the stored profile another file, its folder and the deletion
   *  (all but the folder wait while the form holds changes); for a new form a file (and the
   *  folder of a file that does not read). */
  const entries = $derived.by((): MenuEntry[] => {
    const held = { disabled: dirty, reason: dirty ? t.profile.saveFirst : null };
    const pick: MenuEntry = {
      id: 'pick',
      label: stored ? t.profile.pickOther : t.profile.pick,
      icon: 'pickFile',
      ...held,
      run: onpick,
    };
    const folder: MenuEntry = {
      id: 'folder',
      label: t.common.openFolder,
      icon: 'folder',
      run: onopenfolder,
    };
    if (!stored) return replacesBroken ? [pick, folder] : [pick];
    return [
      pick,
      folder,
      { kind: 'separator' },
      {
        id: 'remove',
        label: t.profile.remove,
        icon: 'trash',
        danger: true,
        ...held,
        run: onremove,
      },
    ];
  });

  /** The menu opens right below the button, its right edge on the button's. */
  function more(): void {
    if (anchor === null || menuState.open !== null) return;
    expanded = true;
    openMenu({
      label: t.profile.more,
      anchor: { kind: 'below', rect: anchor.getBoundingClientRect(), align: 'end' },
      entries,
      onclose: () => (expanded = false),
    });
  }
</script>

{#if actions || checks > 0 || rescoring}
  <div class="head" data-first-row data-testid="profile-head">
    <div class="status">
      {#if checks > 0}
        <span class="check" in:fade>
          <Button
            variant="ghost"
            size="sm"
            icon="warning"
            label={t.profile.check(checks)}
            testid="profile-check"
            onclick={oncheck}
          />
        </span>
      {/if}
      {#if rescoring}
        <p class="quiet" data-testid="profile-rescoring" in:fade>
          <Spinner size="sm" label={null} />{t.profile.rescoring(profile?.pending ?? 0)}
        </p>
      {/if}
    </div>
    {#if actions}
      <div class="actions">
        <Button
          variant="secondary"
          size="field"
          icon="paste"
          label={stored ? t.profile.updateFromCv : t.profile.fromCv}
          disabled={dirty}
          disabledReason={t.profile.saveFirst}
          testid={stored ? 'profile-update-cv' : 'profile-from-cv'}
          onclick={onfromcv}
        />
        <span class="more" bind:this={anchor}>
          <Button
            variant="secondary"
            size="field"
            iconOnly
            icon="more"
            label={t.profile.more}
            menu
            {expanded}
            loading={picking}
            testid="profile-more"
            onclick={more}
          />
        </span>
      </div>
    {/if}
  </div>
{/if}
{#if notes.length > 0 || replacing || replacesBroken || note}
  <div class="notes">
    {#each notes as warning, index (index)}
      <Notice
        tone="info"
        variant="inline"
        text={warning.text}
        action={warning.folder
          ? { label: t.common.openFolder, icon: 'folder', onclick: onopenfolder }
          : null}
        testid="profile-warning"
      />
    {/each}
    {#if replacing}
      <Notice
        tone="info"
        variant="inline"
        text={t.profile.replacesStored}
        testid="profile-replaces"
      />
    {/if}
    {#if replacesBroken}
      <Notice tone="info" variant="inline" text={t.profile.replaces} testid="profile-replaces" />
    {/if}
    {#if note}
      <Notice tone="danger" variant="inline" text={note} testid="profile-note" />
    {/if}
  </div>
{/if}

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-12);
  }

  .status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-8) var(--space-16);
    min-width: 0;
  }

  /* The ghost button's text starts on the column's edge. */
  .check {
    display: flex;
    margin-left: calc(-1 * var(--ghost-inset));
  }

  .quiet {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    color: var(--text-muted);
    font: var(--type-sm);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-8);
    margin-left: auto;
  }

  .more {
    display: flex;
  }

  .notes {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    margin-top: calc(-1 * var(--space-16));
  }
</style>
