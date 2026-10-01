<!--
  The start of a new profile (user decision 2026-10-01: a page, no dialog): the title on the
  first row ("Neues Profil", or what is wrong with a stored file that no longer reads), one
  sentence what the profile is for, and the card of the three ways (shared/NewProfileWays).
  Opened from the menu of the profiles beside an existing one, "Abbrechen" at the title goes
  back to it. A file that no longer reads also offers its folder, to fix it by hand.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import Notice from '$components/Notice.svelte';
  import { t } from '$lib/i18n/t';
  import NewProfileWays from '../shared/NewProfileWays.svelte';

  interface Props {
    heading: string;
    text: string;
    /** The stored file no longer reads: its folder is at hand. */
    unreadable?: boolean;
    note: string | null;
    onempty: () => void;
    onfile: () => Promise<void>;
    /** Back to the profile it was opened beside (the menu's "Neues Profil"). */
    oncancel?: (() => void) | null;
    onopenfolder?: () => void;
  }

  let {
    heading,
    text,
    unreadable = false,
    note,
    onempty,
    onfile,
    oncancel = null,
    onopenfolder,
  }: Props = $props();
</script>

<div class="start" data-testid="profile-empty">
  <div class="head" data-first-row>
    <h1 class="title" data-testid="profile-start-heading">{heading}</h1>
    {#if oncancel}
      <Button
        variant="secondary"
        size="sm"
        label={t.common.cancel}
        testid="profile-start-cancel"
        onclick={oncancel}
      />
    {/if}
  </div>
  <p class="text">{text}</p>
  <NewProfileWays {onempty} {onfile} />
  {#if unreadable && onopenfolder}
    <div>
      <Button
        variant="link"
        icon="folder"
        label={t.common.openFolder}
        testid="profile-folder"
        onclick={onopenfolder}
      />
    </div>
  {/if}
  {#if note}
    <Notice tone="danger" variant="inline" text={note} testid="profile-note" />
  {/if}
</div>

<style>
  .start {
    display: flex;
    flex-direction: column;
    gap: var(--space-16);
  }

  /* The title on the first row of the window, like the profile's own name. */
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-12);
  }

  .title {
    min-width: 0;
    color: var(--text-heading);
    font: var(--type-2xl);
    letter-spacing: var(--tracking-tight);
  }

  .text {
    margin-top: calc(-1 * var(--space-8));
    color: var(--text-muted);
    font: var(--type-sm);
  }
</style>
