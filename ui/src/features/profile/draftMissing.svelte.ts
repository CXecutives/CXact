// What a new or changed form still lacks ("Noch 2 Angaben offen" before the first save): core
// is asked (`profileMissing`, core::profile::missing_required) at once for a new form, then a
// moment after each edit; the stored profile names its own (`ProfileInfo.missing`), so a form
// without changes asks nothing.

import { profileMissing } from '$lib/ipc/api';
import type { ProfileForm } from '$lib/ipc/types';
import { editor } from '$lib/state/profile.svelte';
import { untrack } from 'svelte';

/** How long the form rests before core is asked what it still lacks. */
const PAUSE = 250;

/**
 * Follows the editor while the component that calls it lives (call it during its init).
 * `fields()` is what core said the form lacks, or null while the stored profile's word holds.
 */
export function draftMissing(): { fields: () => string[] | null } {
  let fields = $state.raw<string[] | null>(null);
  let asked = 0;
  const drafting = $derived(editor.origin === 'new' || editor.dirty);
  $effect(() => {
    if (!drafting) {
      untrack(() => (fields = null));
      return;
    }
    const form = $state.snapshot(editor.after) as ProfileForm;
    const mine = ++asked;
    const timer = setTimeout(
      () => {
        profileMissing(form)
          .then((answer) => {
            if (mine === asked) fields = answer;
          })
          .catch(() => undefined);
      },
      untrack(() => fields) === null ? 0 : PAUSE,
    );
    return () => clearTimeout(timer);
  });
  return { fields: () => fields };
}
