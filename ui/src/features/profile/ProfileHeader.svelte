<!--
  The head of the Profil view, on the first row of the window (`data-first-row`): on the left
  the profile switcher, a button with the active profile's name (text a user would copy) and
  a chevron whose menu lists every profile (a check at the active one), then what can be done
  with them (Neues Profil, Profil duplizieren, Umbenennen, Aus Datei laden, Ordner öffnen and
  "Profil löschen" in red, which asks first naming the profile); after it a status only when
  there is one ("n Werte prüfen" while values of the file do not read, a click goes to the
  first one; the rescore a save or a switch started; each fades in and out, 32 px like the
  others of the row). On the right only one button: an update from a CV (for a new form one
  from a CV). The form below says who the profile is about, so the head does not repeat it.
  While the form holds changes, what would replace or drop them waits and says "Erst
  speichern oder verwerfen." (another profile asks first, ProfileView). Under the row, only
  where it prevents a mistake: keys of the file the app does not read (with the folder at
  hand), that saving a chosen file replaces the profile, and a failure.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import MenuButton from '$components/MenuButton.svelte';
  import Notice from '$components/Notice.svelte';
  import Spinner from '$components/Spinner.svelte';
  import { t } from '$lib/i18n/t';
  import { warningText } from '$lib/i18n/texts';
  import type { Notice as NoticeData, ProfileEntry, ProfileInfo } from '$lib/ipc/types';
  import { fade } from '$lib/motion/transitions';
  import type { MenuEntry } from '$lib/state/menu.svelte';
  import type { DraftOrigin } from '$lib/state/profile.svelte';
  import { profileName } from './profiles';

  interface Props {
    /** `null`: the ways in show (the active profile does not read). */
    origin: DraftOrigin | null;
    profile: ProfileInfo | null;
    /** Every profile of the work folder (none: no switcher). */
    profiles: readonly ProfileEntry[];
    /** How many values are still to check. */
    checks: number;
    /** Warnings said here: what the form cannot change (keys the app does not read). */
    warnings: readonly NoticeData[];
    rescoring: boolean;
    /** Unsaved changes: an update or a deletion would drop them. */
    dirty: boolean;
    /** Saving the draft replaces the stored profile (another file). */
    replacing: boolean;
    /** A change of the profiles is on its way (the switcher turns). */
    switching: boolean;
    note: string | null;
    onswitch: (id: number) => void;
    onnew: () => void;
    onduplicate: () => void;
    onrename: () => void;
    onload: () => void;
    onremove: () => void;
    onfromcv: () => void;
    onopenfolder: () => void;
    /** "n Werte prüfen": the caret goes to the first one. */
    oncheck: () => void;
  }

  let {
    origin,
    profile,
    profiles,
    checks,
    warnings,
    rescoring,
    dirty,
    replacing,
    switching,
    note,
    onswitch,
    onnew,
    onduplicate,
    onrename,
    onload,
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
  /** The update from a CV: for the stored profile and a new form (a draft is saved or
   *  discarded). */
  const actions = $derived(stored || origin === 'new');

  // ---------------------------------------------------------------- the switcher
  const active = $derived(profiles.find((entry) => entry.active) ?? null);
  const optionId = (entry: ProfileEntry): string => `profile-${entry.id}`;
  const options = $derived(
    profiles.map((entry) => ({ id: optionId(entry), label: profileName(entry) })),
  );

  /** What can be done with the profiles; another profile asks first while the form holds
   *  changes, the deletion waits for them (it asks itself). */
  const entries = $derived.by((): MenuEntry[] => [
    { id: 'new', label: t.profile.newProfile, icon: 'add', run: onnew },
    { id: 'duplicate', label: t.profile.duplicate, icon: 'copy', run: onduplicate },
    { id: 'rename', label: t.profile.rename, icon: 'edit', run: onrename },
    { id: 'load', label: t.profile.load, icon: 'pickFile', run: onload },
    { id: 'folder', label: t.common.openFolder, icon: 'folder', run: onopenfolder },
    { kind: 'separator' },
    {
      id: 'remove',
      label: t.profile.remove,
      icon: 'trash',
      danger: true,
      disabled: dirty,
      reason: dirty ? t.profile.saveFirst : null,
      run: onremove,
    },
  ]);

  function chosen(id: string): void {
    const entry = profiles.find((candidate) => optionId(candidate) === id);
    if (entry !== undefined) onswitch(entry.id);
  }
</script>

{#if active !== null || actions || checks > 0 || rescoring}
  <div class="head" data-first-row data-testid="profile-head">
    <div class="status">
      {#if active !== null}
        <MenuButton
          field
          copy
          {options}
          value={optionId(active)}
          menuLabel={t.profile.profiles}
          actions={entries}
          loading={switching}
          testid="profile-switcher"
          onchange={chosen}
        />
      {/if}
      {#if checks > 0}
        <span class="check" transition:fade>
          <Button
            variant="ghost"
            size="field"
            icon="warning"
            label={t.profile.check(checks)}
            testid="profile-check"
            onclick={oncheck}
          />
        </span>
      {/if}
      {#if rescoring}
        <p class="quiet" data-testid="profile-rescoring" transition:fade>
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
      </div>
    {/if}
  </div>
{/if}{#if notes.length > 0 || replacing || replacesBroken || note}
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
    max-width: 100%;
  }

  .check {
    display: flex;
  }

  /* First in the row, the ghost button's text starts on the column's edge. */
  .check:first-child {
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

  .notes {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    margin-top: calc(-1 * var(--space-16));
  }
</style>
