<!--
  The setup's "Dein Profil" (the round 10 draft): a whole page on the setup's cream (Page
  `bg`), its head the title 26/650 and the lead (as the CV filled it, or empty to fill in),
  the Profil's form in its setup mode (ProfileView `setup`: no CV button, no save bar, no
  "Häufig verlangt"), and the bar at its foot (BottomBar): Zurück at the left, Weiter at the
  right. Weiter marks what is still missing red and brings the first of it into view (no
  sentence); once nothing is, it saves and goes on. A failed save stays on the page and says
  so in the form.
-->
<script lang="ts">
  import BottomBar from '$components/BottomBar.svelte';
  import Button from '$components/Button.svelte';
  import Page from '$components/Page.svelte';
  import { t } from '$lib/i18n/t';
  import ProfileView from '../profile/ProfileView.svelte';

  interface Props {
    heading: string;
    lead: string;
    /** The heading's element (it takes the focus). */
    headingElement?: HTMLElement | null;
    /** The page's element (the setup scrolls its view to the top). */
    element?: HTMLElement | null;
    onback: () => void;
    /** The profile is saved and complete: the next step. */
    ondone: () => void;
  }

  let {
    heading,
    lead,
    headingElement = $bindable(null),
    element = $bindable(null),
    onback,
    ondone,
  }: Props = $props();

  let view = $state<ProfileView | null>(null);
  let busy = $state(false);

  /** Weiter (and Enter): on once the profile is saved with nothing required open. */
  export async function next(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      if (await view?.next()) ondone();
    } finally {
      busy = false;
    }
  }
</script>

{#snippet head()}
  <header class="head">
    <h1
      class="title"
      id="first-step-heading"
      tabindex="-1"
      bind:this={headingElement}
      data-testid="first-heading"
    >
      <span data-heading>{heading}</span>
    </h1>
    <p class="lead" data-testid="first-lead">{lead}</p>
  </header>
{/snippet}

{#snippet foot()}
  {#snippet actions()}
    <Button
      variant="primary"
      label={t.firstRun.next}
      trailing="next"
      loading={busy}
      testid="first-next"
      onclick={() => void next()}
    />
  {/snippet}
  <BottomBar {actions} testid="first-bar">
    <span class="back">
      <Button
        variant="ghost"
        icon="back"
        label={t.common.back}
        testid="first-back"
        onclick={onback}
      />
    </span>
  </BottomBar>
{/snippet}

<Page ground="bg" {head} {foot} bind:element testid="first-profile">
  <ProfileView bind:this={view} setup />
</Page>

<style>
  /* 2 in, like the titles of the groups under it; lower than a page's head and further from
     the form (the page's own spacing comes on top). */
  .head {
    display: flex;
    flex-direction: column;
    gap: var(--setup-page-lead-gap);
    padding: calc(var(--setup-page-top) - var(--page-top-pad)) var(--space-2)
      calc(var(--setup-page-body-gap) - var(--page-head-gap));
  }

  .title {
    color: var(--text-heading);
    font: var(--type-display);
    letter-spacing: var(--tracking-display);
    outline: none;
  }

  .lead {
    color: var(--text-muted);
    font: var(--type-lead);
  }

  .back {
    display: flex;
    margin-left: var(--setup-back-pull);
  }
</style>
