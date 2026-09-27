<!--
  The field of "Profil umbenennen" (inside its dialog): the profile's name as the switcher
  shows it, all of it selected once the dialog stands, so typing replaces it; Enter renames,
  Esc cancels (the dialog's keys). Emptied, the profile goes by its role or number again,
  which the placeholder shows.
-->
<script lang="ts">
  import TextField from '$components/TextField.svelte';
  import { t } from '$lib/i18n/t';
  import { onMount } from 'svelte';

  interface Props {
    value: string;
    /** The name the profile goes by without one of its own. */
    placeholder: string;
  }

  let { value = $bindable(), placeholder }: Props = $props();

  // The dialog has just taken the focus for its own button and gives it to the field.
  onMount(() => {
    const frame = requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>('[data-testid="profile-rename"]');
      input?.focus({ preventScroll: true });
      input?.select();
    });
    return () => cancelAnimationFrame(frame);
  });
</script>

<TextField bind:value label={t.profile.field.name} {placeholder} testid="profile-rename" />
