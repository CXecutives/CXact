<!--
  The start of the profile (a page, no dialog): the title on the first row ("Profil", or what
  is wrong with a stored file that no longer reads), one sentence what the profile is for, and
  the card of the two ways (shared/NewProfileWays). A file that no longer reads also offers its
  folder, to fix it by hand.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import Notice from '$components/Notice.svelte';
  import { t } from '$lib/i18n/t';
  import type { ProfileInfo } from '$lib/ipc/types';
  import NewProfileWays from '../shared/NewProfileWays.svelte';

  interface Props {
    heading: string;
    text: string;
    /** The stored file no longer reads: its folder is at hand. */
    unreadable?: boolean;
    note: string | null;
    onfilled: (info: ProfileInfo) => void;
    onempty: () => void;
    onopenfolder?: () => void;
  }

  let {
    heading,
    text,
    unreadable = false,
    note,
    onfilled,
    onempty,
    onopenfolder,
  }: Props = $props();
</script>

<div class="start" data-testid="profile-empty">
  <h1 class="title" data-first-row data-testid="profile-start-heading">{heading}</h1>
  <p class="text">{text}</p>
  <NewProfileWays {onfilled} {onempty} />
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

  /* The title on the first row of the window, like the profile's own. */
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
