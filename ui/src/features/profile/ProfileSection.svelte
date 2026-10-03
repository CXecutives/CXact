<!--
  One section of the profile form: the heading (H2, 17/600) and its fields in a card 12 px
  below. Its id is the target of its jump link (`profile-section-{id}`).
-->
<script lang="ts">
  import Card from '$components/Card.svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    id: string;
    heading: string;
    children: Snippet;
  }

  let { id, heading, children }: Props = $props();
</script>

<section
  class="section"
  id="profile-section-{id}"
  aria-labelledby="profile-section-{id}-heading"
  data-section={id}
  data-testid="section-{id}"
>
  <h2 class="heading" id="profile-section-{id}-heading" tabindex="-1">{heading}</h2>
  <Card padding="md">
    <div class="fields">{@render children()}</div>
  </Card>
</section>

<style>
  /* A jump lands the heading under the jump links. */
  .section {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
    scroll-margin-top: calc(var(--control-field) + var(--space-16));
  }

  .heading {
    color: var(--text-heading);
    font: var(--type-lg);
    outline: none;
  }

  .fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-16);
    container-type: inline-size;
  }
</style>
