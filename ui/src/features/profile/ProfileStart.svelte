<!--
  The Profil without a profile: under the view's head one sentence what the profile is for
  (or what is wrong with a stored file that no longer reads, with its folder at hand) and the
  two ways in as tiles (shared/NewProfileWays): "Aus Lebenslauf" asks for the CV at once
  (fromCv.svelte.ts), "Selbst ausfüllen" opens the empty form. What went wrong with the CV
  stands under the tiles as a state box, with "Datei auswählen" where a new try can work.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import StateBox from '$components/StateBox.svelte';
  import { t } from '$lib/i18n/t';
  import type { ProfileInfo } from '$lib/ipc/types';
  import NewProfileWays from '../shared/NewProfileWays.svelte';
  import { fromCv } from '../shared/fromCv.svelte';
  import CvProblem from './CvProblem.svelte';

  interface Props {
    text: string;
    /** The stored file no longer reads: its folder is at hand. */
    unreadable?: boolean;
    note: string | null;
    onfilled: (info: ProfileInfo) => void;
    onempty: () => void;
    onopenfolder?: () => void;
  }

  let { text, unreadable = false, note, onfilled, onempty, onopenfolder }: Props = $props();

  async function cv(): Promise<void> {
    const info = await fromCv.run();
    if (info !== null) onfilled(info);
  }
</script>

<div class="start" data-testid="profile-empty">
  <p class="text">{text}</p>
  <NewProfileWays oncv={() => void cv()} onself={onempty} testid="new-profile-ways" />
  <CvProblem onpick={() => void cv()} />
  {#if unreadable && onopenfolder}
    <div>
      <Button
        variant="secondary"
        icon="folder"
        label={t.common.openFolder}
        testid="profile-folder"
        onclick={onopenfolder}
      />
    </div>
  {/if}
  {#if note}
    <StateBox heading={note} alert testid="profile-note" />
  {/if}
</div>

<style>
  .start {
    display: flex;
    flex-direction: column;
    gap: var(--space-16);
  }

  /* 2 in like the page's title above it. */
  .text {
    margin-inline: var(--section-inset);
    color: var(--text-muted);
    font: var(--type-md);
  }
</style>
