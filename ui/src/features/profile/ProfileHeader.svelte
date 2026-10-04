<!--
  The head of the Profil view, its title block on the first row of the window
  (`data-first-row`): "Profil" as the page's title (26/600 in the heading colour) and at its
  right "Aus Lebenslauf ausfüllen" (secondary: Speichern is the view's one primary), which
  waits while the form holds changes and says ahead of the click when no evaluation is left
  today. Under the title, each only while it has something to say
  and each one quiet line: the required fields still empty ("Noch 2 Angaben offen" with "Zum
  ersten", which puts the caret there), the dot of the fields the CV filled ("aus dem
  Lebenslauf"), the rescore a save started; then what went wrong with the CV (with its way on)
  and a failure of the view. In the setup (`bare`) only those lines: the setup's step names
  the page and the CV had its own step.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import Notice from '$components/Notice.svelte';
  import Spinner from '$components/Spinner.svelte';
  import { t } from '$lib/i18n/t';
  import { fade } from '$lib/motion/transitions';
  import { fromCv } from '../shared/fromCv.svelte';

  interface Props {
    /** How many required fields are still empty. */
    open: number;
    /** A field carries the dot of the CV. */
    filled: boolean;
    rescoring: boolean;
    pending: number;
    /** The form holds changes: the CV waits for them. */
    dirty: boolean;
    note: string | null;
    /** "Zum ersten": the caret into the first empty required field. */
    onfirst: () => void;
    oncv: () => void;
    /** The setup: no title, no "Aus Lebenslauf ausfüllen". */
    bare?: boolean;
  }

  let {
    open,
    filled,
    rescoring,
    pending,
    dirty,
    note,
    onfirst,
    oncv,
    bare = false,
  }: Props = $props();
</script>

<div class="box" data-testid="profile-head">
  {#if !bare}
    <div class="head" data-first-row>
      <h1 class="name" data-testid="profile-heading">{t.profile.title}</h1>
      <Button
        variant="secondary"
        icon="pickFile"
        label={t.profile.fromCv}
        loading={fromCv.busy}
        disabled={dirty || fromCv.limited}
        disabledReason={fromCv.limited ? t.profile.cvError.limit : t.profile.saveFirst}
        testid="profile-from-cv"
        onclick={oncv}
      />
    </div>
  {/if}
  {#if open > 0 || filled || rescoring}
    <div class="lines">
      {#if open > 0}
        <p class="line" data-testid="profile-open" transition:fade>
          <span>{t.profile.open(open)}</span>
          <Button
            variant="link"
            label={t.profile.toFirst}
            testid="profile-to-first"
            onclick={onfirst}
          />
        </p>
      {/if}
      {#if filled}
        <p class="line" data-testid="profile-ai-filled" transition:fade>
          <span class="mark" aria-hidden="true"></span>{t.profile.aiFilled}
        </p>
      {/if}
      {#if rescoring}
        <p class="line" data-testid="profile-rescoring" transition:fade>
          <Spinner size="sm" label={null} />{t.profile.rescoring(pending)}
        </p>
      {/if}
    </div>
  {/if}
</div>
{#if (fromCv.problem && !bare) || note}
  <div class="notes">
    {#if fromCv.problem && !bare}
      {@const problem = fromCv.problem}
      <Notice
        tone="danger"
        variant="inline"
        text={problem.text()}
        action={problem.again
          ? { label: problem.again(), testid: 'cv-again', onclick: oncv }
          : null}
        testid="cv-error"
      />
    {/if}
    {#if note}
      <Notice tone="danger" variant="inline" text={note} testid="profile-note" />
    {/if}
  </div>
{/if}

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-8) var(--space-16);
  }

  .name {
    min-width: 0;
    color: var(--text-heading);
    font: var(--type-2xl);
    letter-spacing: var(--tracking-tight);
  }

  .lines {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin-top: var(--space-8);
  }

  .line {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    min-height: var(--control-sm);
    color: var(--text-muted);
    font: var(--type-sm);
  }

  /* The dot of a field the CV filled, as beside its label (Field). */
  .mark {
    flex: none;
    width: var(--dot-unread);
    height: var(--dot-unread);
    border-radius: var(--radius-full);
    background-color: var(--active-text);
  }

  .notes {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    margin-top: calc(-1 * var(--space-16));
  }
</style>
