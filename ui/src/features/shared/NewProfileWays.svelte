<!--
  The two ways to the profile as the rows of one card, each with its one button: "Aus
  Lebenslauf ausfüllen" (the CV is evaluated by an AI and the profile saved at once,
  fromCv.svelte.ts) and "Selbst ausfüllen" (the empty form, stored on "Speichern"). What went
  wrong with the CV is said at the end of the card with its way on; with no evaluation left
  today its button says so ahead of the click. The Profil view shows it without a profile.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import Card from '$components/Card.svelte';
  import Notice from '$components/Notice.svelte';
  import SettingRow from '$components/SettingRow.svelte';
  import { t } from '$lib/i18n/t';
  import type { ProfileInfo } from '$lib/ipc/types';
  import { fromCv } from './fromCv.svelte';

  interface Props {
    /** The CV filled the profile, which is stored now. */
    onfilled: (info: ProfileInfo) => void;
    /** "Selbst ausfüllen": the empty form. */
    onempty: () => void;
  }

  let { onfilled, onempty }: Props = $props();

  async function cv(): Promise<void> {
    const info = await fromCv.run();
    if (info !== null) onfilled(info);
  }
</script>

<Card padding="rows" testid="new-profile-ways">
  <SettingRow label={t.profile.fromCv} hint={t.profile.fromCvHint} testid="new-profile-way-cv">
    <Button
      variant="secondary"
      icon="pickFile"
      label={t.profile.pickCv}
      loading={fromCv.busy}
      disabled={fromCv.limited}
      disabledReason={t.profile.cvError.limit}
      testid="new-profile-cv"
      onclick={() => void cv()}
    />
  </SettingRow>
  <SettingRow label={t.profile.byHand} hint={t.profile.byHandHint} testid="new-profile-way-empty">
    <Button
      variant="secondary"
      icon="edit"
      label={t.profile.startEmpty}
      disabled={fromCv.busy}
      testid="new-profile-empty"
      onclick={onempty}
    />
  </SettingRow>
  {#if fromCv.problem}
    {@const problem = fromCv.problem}
    <div class="note">
      <Notice
        tone="danger"
        variant="inline"
        text={problem.text()}
        action={problem.again
          ? { label: problem.again(), testid: 'cv-again', onclick: () => void cv() }
          : null}
        testid="cv-error"
      />
    </div>
  {/if}
</Card>

<style>
  /* A note runs on the rows' inset. */
  .note {
    padding: 0 var(--row-inset) var(--space-12);
  }
</style>
