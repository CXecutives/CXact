<!--
  The Profil's head (the round 10 draft): the title "Profil" 20/650 (or what is wrong with a
  file that no longer reads) and, while there is a form, the page's own action at its end:
  "Aus Lebenslauf ausfüllen" (secondary, file-up), which opens the file dialog at once. While
  the CV is evaluated a 16 px spinner and "Wird von einer KI ausgewertet" (13 muted) stand in
  its place, in the same width (both share one cell, the wider sets it), also on the start
  page without a form. It waits, its tooltip saying why, while a value is wrong or no
  evaluation is left today. What went wrong with the CV stands under the head as a state box
  (ProfileView). A file that no longer reads has "Ordner öffnen" there instead, its folder at
  hand.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import PageHeader from '$components/PageHeader.svelte';
  import Spinner from '$components/Spinner.svelte';
  import { t } from '$lib/i18n/t';
  import { fromCv } from '../shared/fromCv.svelte';

  interface Props {
    heading: string;
    /** There is a form: the CV can fill it. */
    form: boolean;
    /** The label of a value that is wrong: the CV waits. */
    held: string | null;
    /** The file dialog of the CV. */
    oncv: () => void;
    /** The folder of a file that no longer reads (no form): the head's action. */
    onfolder?: (() => void) | null;
  }

  let { heading, form, held, oncv, onfolder = null }: Props = $props();
</script>

{#snippet folder()}
  <Button
    variant="secondary"
    icon="folder"
    label={t.common.openFolder}
    testid="profile-folder"
    onclick={() => onfolder?.()}
  />
{/snippet}

{#snippet actions()}
  <span class="cv" class:busy={fromCv.busy}>
    <span class="face button" aria-hidden={fromCv.busy ? 'true' : undefined}>
      <Button
        variant="secondary"
        icon="pickFile"
        label={t.profile.fromCv}
        disabled={held !== null || fromCv.limited}
        disabledReason={fromCv.limited
          ? t.profile.cvError.limit
          : held !== null
            ? t.profile.fixFirst(held)
            : null}
        testid="profile-from-cv"
        onclick={oncv}
      />
    </span>
    <span class="face working" role="status" data-testid="profile-cv-busy">
      {#if fromCv.busy}<Spinner size="sm" label={null} />{:else}<span class="slot"></span>{/if}{t
        .profile.cvBusy}
    </span>
  </span>
{/snippet}

<PageHeader
  {heading}
  headingTestid="profile-heading"
  actions={form || fromCv.busy ? actions : onfolder ? folder : null}
  column="page"
  testid="profile-head"
/>

<style>
  /* The button and the busy line share one cell: the wider one gives both its width. */
  .cv {
    display: inline-grid;
    justify-items: end;
  }

  .face {
    display: inline-flex;
    grid-area: 1 / 1;
    align-items: center;
  }

  .working {
    gap: var(--space-8);
    visibility: hidden;
    color: var(--text-muted);
    font: var(--type-sm);
    white-space: nowrap;
  }

  /* The spinner's room while there is none (the cell keeps its width). */
  .slot {
    width: var(--spinner-sm);
  }

  .busy .working {
    visibility: visible;
  }

  .busy .button {
    visibility: hidden;
  }
</style>
