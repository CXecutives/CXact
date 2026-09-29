<!--
  A value of the profile file the app could not read, said where its field is: what the file
  had, in the danger tone of a field's error, and "Wert entfernen" as the way on. It is laid
  out as a field's help line with its way on (Field): as wide as the field (also under a
  control narrower than that, a choice), the message shrinks and wraps and the link ends its
  first line, so "Wert entfernen" stands at the end of the field's width at every field.
  Removing it takes effect when the profile is saved (or, for one entry of a list, removes the
  entry at once). It goes like any removed item (input.ts removeBy): in a list of notes
  (`data-removes`) the keyboard's focus moves on to the next one.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import Icon from '$components/Icon.svelte';
  import { t } from '$lib/i18n/t';
  import { removeBy } from '$lib/input/input';

  interface Props {
    text: string;
    /** For the `aria-describedby` of the field it belongs to. */
    id?: string | null;
    testid?: string | null;
    onremove: () => void;
  }

  let { text, id = null, testid = null, onremove }: Props = $props();
</script>

<div class="note" data-testid={testid ?? undefined}>
  <p class="text" id={id ?? undefined} role="alert">
    <Icon name="warning" size="sm" />
    <span>{text}</span>
  </p>
  <span class="action" data-remove>
    <Button
      variant="link"
      size="sm"
      label={t.profile.field.removeValue}
      testid="value-remove"
      onclick={(event) => removeBy(event.currentTarget, onremove)}
    />
  </span>
</div>

<style>
  /* As a field's help line with its way on (Field .acts): the full width of the field, the
     message shrinks and the link ends its first line. */
  .note {
    display: flex;
    align-self: stretch;
    align-items: flex-start;
    gap: var(--space-12);
    min-height: var(--control-sm);
  }

  /* The icon sits on the first line when the text wraps (as a field's error). */
  .text {
    display: flex;
    flex: 1 1 auto;
    align-items: flex-start;
    gap: var(--space-6);
    min-width: 0;
    padding-block: calc((var(--control-sm) - var(--leading-sm)) / 2);
    color: var(--danger-strong);
    font: var(--type-sm);
  }

  .text > :global(:first-child) {
    flex: none;
    margin-top: calc((var(--leading-sm) - var(--icon-sm)) / 2);
  }

  .action {
    display: inline-flex;
    flex: none;
    margin-left: auto;
  }
</style>
