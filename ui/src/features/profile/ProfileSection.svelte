<!--
  One section of the profile form: its heading above the card and its rows in the card
  (components/Section). The rows bring their own padding and hairlines (ProfileEditor).
-->
<script lang="ts">
  import Section from '$components/Section.svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    id: string;
    heading: string;
    children: Snippet;
  }

  let { id, heading, children }: Props = $props();
</script>

<Section id="profile-section-{id}" name={id} {heading} padding="none" testid="section-{id}">
  <div class="fields">{@render children()}</div>
</Section>

<style>
  /* The rows run edge to edge and pad their content by the card's inset; the fields ask its
     width (Field `side`). */
  .fields {
    display: flex;
    flex-direction: column;
    padding: 0 var(--card-padding);
    container-type: inline-size;
    --row-inset: var(--card-padding);
  }
</style>
