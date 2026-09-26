<!--
  "Favoriten": the favourites of the inbox that "Heute ansehen" does not show already (its
  star marks them there), newest first; with more than fit here a link to all of them.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import { t } from '$lib/i18n/t';
  import { toFavourites } from '../lead';
  import { overview } from '../model.svelte';
  import Block from './Block.svelte';
  import JobRows from './JobRows.svelte';

  let error = $state<string | null>(null);
</script>

{#snippet all()}
  <Button
    variant="link"
    size="sm"
    label={t.overview.allFavourites(overview.moreFavourites)}
    testid="overview-all-favourites"
    onclick={toFavourites}
  />
{/snippet}

<Block
  testid="favourites"
  heading={t.overview.favourites}
  list="jobs"
  {error}
  footer={overview.moreFavourites > 0 ? all : null}
>
  <JobRows list={overview.favourites} prefix="favourite" onerror={(next) => (error = next)} />
</Block>
