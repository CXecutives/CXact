<!--
  The Profil's head (the round 10 draft): the title "Profil" 20/650 (or what is wrong with a
  file that no longer reads) and, while there is a form, the page's own action at its end:
  "Aus Lebenslauf ausfüllen" (secondary, file-up), which opens the file dialog at once. While
  the CV is evaluated a 16 px spinner and "Wird von einer KI ausgewertet" (13 muted) stand in
  its place, in the same width (both share one cell, the wider sets it). It waits, its
  tooltip saying why, while the form holds changes or no evaluation is left today. What went
  wrong with the CV stands under the head as a state box (ProfileView). A file that no longer
  reads has "Ordner öffnen" there instead, its folder at hand.
  A stored profile with wished roles shows them as its title instead (round 11, 26/650, text
  to copy) and under them its facts (day rate, work mode, availability, countries), each a
  quiet button with its glyph that opens its group at that field.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import PageHeader from '$components/PageHeader.svelte';
  import Spinner from '$components/Spinner.svelte';
  import { t } from '$lib/i18n/t';
  import type { IconMeaning } from '$lib/icons';
  import { fromCv } from '../shared/fromCv.svelte';

  interface Props {
    heading: string;
    /** There is a form: the CV can fill it. */
    form: boolean;
    /** The form holds a change: the CV waits. */
    dirty: boolean;
    /** The file dialog of the CV. */
    oncv: () => void;
    /** The folder of a file that no longer reads (no form): the head's action. */
    onfolder?: (() => void) | null;
    /** The wished roles: the title of a stored profile. */
    roles?: readonly string[];
    /** The facts under the roles; a click opens the field. */
    facts?: readonly { icon: IconMeaning; text: string; field: string }[];
    onfact?: (field: string) => void;
  }

  let {
    heading,
    form,
    dirty,
    oncv,
    onfolder = null,
    roles = [],
    facts = [],
    onfact = () => undefined,
  }: Props = $props();

  const hero = $derived(form && roles.length > 0);
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
        disabled={dirty || fromCv.limited}
        disabledReason={fromCv.limited ? t.profile.cvError.limit : t.profile.saveFirst}
        testid="profile-from-cv"
        onclick={oncv}
      />
    </span>
    <span class="face working" role="status" data-testid="profile-cv-busy">
      <Spinner size="sm" label={null} />{t.profile.cvBusy}
    </span>
  </span>
{/snippet}

{#snippet title()}
  <h1 class="hero" data-copy data-testid="profile-heading">{roles.join(', ')}</h1>
{/snippet}

{#snippet factRow()}
  {#if hero && facts.length > 0}
    <ul class="facts" data-testid="profile-facts">
      {#each facts as fact (fact.field)}
        <li>
          <Button
            variant="ghost"
            icon={fact.icon}
            label={fact.text}
            testid="fact-{fact.field}"
            onclick={() => onfact(fact.field)}
          />
        </li>
      {/each}
    </ul>
  {/if}
{/snippet}

<PageHeader
  heading={hero ? null : heading}
  headingTestid="profile-heading"
  lead={hero ? title : null}
  actions={form ? actions : onfolder ? folder : null}
  column="page"
  testid="profile-head"
  children={factRow}
/>

<style>
  .hero {
    min-width: 0;
    color: var(--text-heading);
    font: var(--type-display);
    letter-spacing: var(--tracking-display);
    text-wrap: balance;
    outline: none;
  }

  /* The facts 8 under the title, the first one's glyph on the title's edge. */
  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4) var(--space-8);
    margin: var(--space-8) 0 0 calc(-1 * var(--ghost-inset));
    padding: 0;
    list-style: none;
  }

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

  .busy .working {
    visibility: visible;
  }

  .busy .button {
    visibility: hidden;
  }
</style>
