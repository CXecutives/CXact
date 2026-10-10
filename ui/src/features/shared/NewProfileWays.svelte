<!--
  The two ways to the profile as two tiles side by side, one look wherever they are (the
  setup's Willkommen, the Profil without a profile): "Aus Lebenslauf ausfüllen" with the one
  sentence about the AI (it opens the file dialog or the upload at once, so it says it here)
  and "Selbst ausfüllen". A click on a tile goes its way at once. In a narrow window the
  tiles stand one under the other.
-->
<script lang="ts">
  import Tile from '$components/Tile.svelte';
  import { t } from '$lib/i18n/t';

  interface Props {
    oncv: () => void;
    onself: () => void;
    testid?: string | null;
  }

  let { oncv, onself, testid = null }: Props = $props();
</script>

<div class="ways" data-testid={testid ?? undefined}>
  <Tile
    icon="document"
    label={t.profile.fromCv}
    note={t.profile.fromCvHint}
    testid="way-cv"
    onclick={oncv}
  />
  <Tile icon="edit" label={t.profile.byHand} testid="way-self" onclick={onself} />
</div>

<style>
  .ways {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(var(--stat-min), 1fr));
    gap: var(--space-8);
  }
</style>
