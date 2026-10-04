<!--
  A section of a page (Profil, Einstellungen; design B "Luftig"): its heading (14 semibold,
  navy) alone on its line, with the info symbol after it where a sentence says what the
  section is for (no line under a heading anywhere), then its content on the white page, no
  card. A section after another one starts under a hairline with room above its heading. Its
  rows bring their own padding and hairlines (SettingRow, PortalRow), its fields their own
  gaps (the Profil's).
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';
  import type { Snippet } from 'svelte';
  import InfoTip from './InfoTip.svelte';

  interface Props {
    heading: string;
    /** The sentence of the info symbol after the heading (what the section is for), or none. */
    info?: string | null;
    /** The id of the section (its heading's is `{id}-heading`). */
    id: string;
    /** Its name in the page's table (`data-section`). */
    name: string;
    testid?: string | null;
    children: Snippet;
  }

  let { heading, info = null, id, name, testid = null, children }: Props = $props();
</script>

<section
  class="section"
  {id}
  aria-labelledby="{id}-heading"
  data-section={name}
  data-testid={testid ?? undefined}
>
  <div class="head">
    <h2 class="heading" id="{id}-heading">{heading}</h2>
    {#if info}<InfoTip text={info} label={t.common.infoAbout(heading)} />{/if}
  </div>
  <div class="body">{@render children()}</div>
</section>

<style>
  .section {
    display: flex;
    flex-direction: column;
    gap: var(--section-head-gap);
  }

  /* The next section: a hairline, and room above its heading. */
  .section + :global(.section) {
    padding-top: var(--section-top);
    border-top: var(--border-width) solid var(--border);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  /* The rows one under the other (each brings its padding and hairline). */
  .body {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .heading {
    color: var(--text-heading);
    font: var(--type-lg);
    letter-spacing: var(--tracking-tight);
  }
</style>
