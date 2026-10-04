<!--
  The one line of what the profile still lacks (design round 3), on top of the Profil and of
  the setup's short form: the warning sign and "Es fehlt noch Wunschrollen und Sprachen.", the
  names in the order of the page joined by commas and "und", each a link that puts the caret
  into its field and lets its row flash (`onjump`). It shows only while something is missing.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import Notice from '$components/Notice.svelte';
  import { t } from '$lib/i18n/t';

  interface Props {
    /** The required fields still empty, in the order of the page, with their names. */
    fields: readonly { field: string; name: string }[];
    onjump: (field: string) => void;
  }

  let { fields, onjump }: Props = $props();
</script>

<Notice tone="warning" testid="profile-missing">
  {t.profile.missingLead}{#each fields as { field, name }, index (field)}{t.profile.missingBefore(
      index,
      fields.length,
    )}<Button
      variant="link"
      inText
      label={name}
      testid="missing-{field}"
      onclick={() => onjump(field)}
    />{/each}.
</Notice>
