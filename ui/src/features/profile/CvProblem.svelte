<!--
  What went wrong with the CV, as a state box (the round 10 draft): "Der Lebenslauf wurde
  nicht ausgewertet." and the reason in one sentence (fromCv.svelte.ts; the setup's upload
  says it in the same two lines); before any try only the reason stands. Under the ways in
  without a profile it offers "Datei auswählen" where a new try can work (the file dialog
  again); under the Profil's head, whose "Aus Lebenslauf ausfüllen" opens the same dialog, it
  has no button. It goes with the next try or when the view closes.
-->
<script lang="ts">
  import StateBox from '$components/StateBox.svelte';
  import { t } from '$lib/i18n/t';
  import { fromCv } from '../shared/fromCv.svelte';

  interface Props {
    /** The file dialog again (null: the page offers it already). */
    onpick?: (() => void) | null;
  }

  let { onpick = null }: Props = $props();
</script>

{#if fromCv.problem}
  {@const problem = fromCv.problem}
  <StateBox
    heading={problem.tried ? t.profile.cvFailed : problem.text()}
    text={problem.tried ? problem.text() : null}
    headingTestid={problem.tried ? null : 'cv-error-text'}
    action={problem.pick && onpick
      ? { label: t.profile.pickFile, icon: 'pickFile', testid: 'cv-pick', onclick: onpick }
      : null}
    alert
    testid="cv-error"
    textTestid="cv-error-text"
  />
{/if}
