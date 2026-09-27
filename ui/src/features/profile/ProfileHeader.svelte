<!--
  The head of the Profil view, its title block on the first row of the window
  (`data-first-row`): the active profile's name as the page's title (26/600 in the heading
  colour, text a user would copy, an ellipsis when long; "Neues Profil" while the form holds
  a new one), right after it a quiet chevron (a small ghost icon button) whose menu lists
  every profile (a check at the active one) and what can be done with them (Neues Profil,
  Profil duplizieren, Umbenennen, Aus Datei laden, Ordner öffnen and "Profil löschen" in red,
  which asks first naming the profile); then a status only when there is one ("n Werte
  prüfen" while values of the file do not read, a click goes to the first one; the rescore a
  save or a switch started; each fades in and out). On the title's line at the right edge of
  the column one quiet button (ghost, with its glyph): the update from a CV, "Aus Lebenslauf
  erstellen" while the profile is new or empty. It stays while a draft is in the form, then
  waiting like everything that would replace or drop the draft ("Erst speichern oder
  verwerfen."), so the focus stays on it after the steps with an AI closed; another profile
  asks first (ProfileView). The form below says who the profile is about, so the head does
  not repeat it. Under the row, only where it prevents a mistake: keys of the file the app
  does not read (with the folder at hand), that saving a chosen file replaces the profile,
  and a failure. Narrower than 480 px the status and the button go to a line of their own.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import Notice from '$components/Notice.svelte';
  import Spinner from '$components/Spinner.svelte';
  import { tooltip } from '$lib/actions/tooltip';
  import { t } from '$lib/i18n/t';
  import { warningText } from '$lib/i18n/texts';
  import type { Notice as NoticeData, ProfileEntry, ProfileInfo } from '$lib/ipc/types';
  import { fade } from '$lib/motion/transitions';
  import { menuState, openMenu, type MenuEntry } from '$lib/state/menu.svelte';
  import type { DraftOrigin } from '$lib/state/profile.svelte';
  import { profileName } from './profiles';

  interface Props {
    /** `null`: the ways in show (the active profile does not read). */
    origin: DraftOrigin | null;
    profile: ProfileInfo | null;
    /** Every profile of the work folder (none: no switcher). */
    profiles: readonly ProfileEntry[];
    /** The form holds a new profile that saving adds beside the others. */
    fresh: boolean;
    /** The stored profile holds something a CV would update (else the button creates). */
    updatable: boolean;
    /** How many values are still to check. */
    checks: number;
    /** Warnings said here: what the form cannot change (keys the app does not read). */
    warnings: readonly NoticeData[];
    rescoring: boolean;
    /** Unsaved changes or a draft: an update or a deletion would drop them. */
    dirty: boolean;
    /** Saving the draft replaces the stored profile (another file). */
    replacing: boolean;
    /** A change of the profiles is on its way (the chevron turns). */
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
    fresh,
    updatable,
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

  /** A new form for a stored file that does not read: saving replaces that file. */
  const replacesBroken = $derived(
    origin === 'new' && !fresh && (profile?.parseError ?? null) !== null,
  );
  const notes = $derived(
    warnings.flatMap((notice) => {
      const text = warningText(notice);
      return text === null ? [] : [{ text, folder: notice.code === 'ignoredKeys' }];
    }),
  );
  /** The update of the stored profile (and while its draft is in the form). */
  const updates = $derived(updatable && (origin === 'stored' || origin === 'update'));

  // ---------------------------------------------------------------- the title and its menu
  const active = $derived(profiles.find((entry) => entry.active) ?? null);
  /** A fresh draft, and a draft without any profile yet, is a new one. */
  const heading = $derived(
    fresh || (active === null && origin !== null)
      ? t.profile.newProfile
      : active === null
        ? null
        : profileName(active),
  );

  /** What can be done with the profiles; another profile asks first while the form holds
   *  changes, the deletion waits for them (it asks itself). */
  const actions = $derived.by((): MenuEntry[] => [
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

  let block = $state<HTMLElement | null>(null);
  let expanded = $state(false);

  /** The menu drops under the title, its left edge on the title's: the profiles first (the
   *  active one checked), then what can be done with them. */
  function openProfiles(event: MouseEvent): void {
    if (block === null || menuState.open !== null) return;
    expanded = true;
    openMenu({
      label: t.profile.profiles,
      anchor: { kind: 'below', rect: block.getBoundingClientRect(), align: 'start' },
      // Enter or Space on the button: the first entry is active at once, like the OS.
      fromKeyboard: event.detail === 0,
      entries: [
        ...profiles.map((entry) => ({
          id: `profile-${entry.id}`,
          label: profileName(entry),
          checked: entry.active,
          run: () => {
            if (!entry.active) onswitch(entry.id);
          },
        })),
        { kind: 'separator' as const },
        ...actions,
      ],
      onclose: () => (expanded = false),
    });
  }
</script>

{#if heading !== null || origin !== null || checks > 0 || rescoring}
  <div class="box" data-testid="profile-head">
    <div class="head" data-first-row>
      {#if heading !== null}
        <div class="title" bind:this={block}>
          <h1
            class="name"
            data-copy
            data-testid="profile-heading"
            use:tooltip={{ text: heading, truncated: true }}
          >
            {heading}
          </h1>
          {#if active !== null}
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon="expand"
              label={t.profile.profiles}
              menu
              {expanded}
              loading={switching}
              testid="profile-switcher"
              onclick={openProfiles}
            />
          {/if}
        </div>
      {/if}
      {#if checks > 0 || rescoring}
        <div class="status">
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
      {/if}
      {#if origin !== null}
        <div class="actions">
          <Button
            variant="ghost"
            size="field"
            icon="paste"
            label={updates ? t.profile.updateFromCv : t.profile.fromCv}
            disabled={dirty}
            disabledReason={t.profile.saveFirst}
            testid={updates ? 'profile-update-cv' : 'profile-from-cv'}
            onclick={onfromcv}
          />
        </div>
      {/if}
    </div>
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
  /* The head's own width decides whether its parts share one line. */
  .box {
    container-type: inline-size;
  }

  .head {
    gap: var(--space-8) var(--space-16);
  }

  /* The name gives way first (an ellipsis); the status and the button keep their size. */
  .title {
    display: flex;
    flex: 0 1 auto;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
  }

  .name {
    min-width: 0;
    overflow: hidden;
    color: var(--text-heading);
    font: var(--type-2xl);
    letter-spacing: var(--tracking-tight);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-8) var(--space-16);
  }

  .check {
    display: flex;
  }

  .quiet {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    color: var(--text-muted);
    font: var(--type-sm);
  }

  /* The quiet button ends on the column's edge with its glyph and words (a ghost button
     hangs out by its padding and border). */
  .actions {
    display: flex;
    flex: none;
    align-items: center;
    margin-right: calc(-1 * var(--ghost-inset));
    margin-left: auto;
  }

  /* Narrow: the title alone on its line, the status and the button on the next. */
  @container (width < 480px) {
    .head {
      flex-wrap: wrap;
    }

    .title {
      flex-basis: 100%;
    }

    /* First on its line, the ghost button's words start on the column's edge. */
    .check {
      margin-left: calc(-1 * var(--ghost-inset));
    }
  }

  .notes {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    margin-top: calc(-1 * var(--space-16));
  }
</style>
