<!--
  The one sentence of what the profile still lacks (design round 4), said only once
  Speichern (the Profil's floating bar) or the setup's Weiter (beside it) was pressed: the
  warning sign and "Es fehlt noch Wunschrollen und Sprachen.", the names in the order of the
  page joined by commas and "und", each a link that puts the caret into its field and lets it
  flash (`onjump`). On the dark bar its words and links are light (the surface's tokens).
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import Icon from '$components/Icon.svelte';
  import { t } from '$lib/i18n/t';

  interface Props {
    /** The required fields still empty, in the order of the page, with their names. */
    fields: readonly { field: string; name: string }[];
    onjump: (field: string) => void;
  }

  let { fields, onjump }: Props = $props();
</script>

<p class="missing" role="status" data-testid="profile-missing">
  <span class="sign"><Icon name="warning" size="sm" /></span>
  <span
    >{t.profile
      .missingLead}{#each fields as { field, name }, index (field)}{t.profile.missingBefore(
        index,
        fields.length,
      )}<Button
        variant="link"
        inText
        label={name}
        testid="missing-{field}"
        onclick={() => onjump(field)}
      />{/each}.</span
  >
</p>

<style>
  .missing {
    display: flex;
    align-items: flex-start;
    gap: var(--space-6);
    min-width: 0;
    color: var(--text);
    font: var(--type-md);
  }

  .sign {
    display: inline-flex;
    flex: none;
    margin-top: calc((var(--leading-md) - var(--icon-sm)) / 2);
    color: var(--warning);
  }
</style>
