<!-- One setting: label and one-sentence hint on the left, badges and the control right. A
     hint that is a value to copy (a path) selects like text (`copy`; it breaks only after a
     separator), and so does a label that is such a value (`copyLabel`, the address of the
     mailbox).
     The row runs edge to edge in its container and pads its content by the container's
     --row-inset, so its divider and its text share the container's grid.
     With `for` (the id of its switch) the row works like a row of the system settings of
     Windows 11 and macOS: only the switch switches (user decision). The label names the
     switch and the hint describes it (`{for}-label`, and `{for}-hint` while there is a hint,
     read by Toggle), but neither is a click target, and the row never reacts to the pointer.
     With `form` (a row among the fields of a form) the label has the 13/500 of a form's
     control labels. A row without a label leads with its hint. A row may lead with a tile
     (`lead`, the mailbox's, 12 from its text) and say a state with a dot before its hint
     (`dot`: Verbunden green, a failure red). -->
<script lang="ts">
  import { describe } from '$lib/state/described';
  import type { Snippet } from 'svelte';

  interface Props {
    label?: string | null;
    hint?: string | null;
    /** Badges next to the label. */
    badges?: Snippet | null;
    /** A tile before the text (the mailbox's). */
    lead?: Snippet | null;
    /** A dot before the hint that says a state (connected, or a failure). */
    dot?: 'success' | 'danger' | null;
    /** The hint is a value a user would copy (a folder path). */
    copy?: boolean;
    /** The label is a value a user would copy (the address of the mailbox). */
    copyLabel?: boolean;
    /** The id of the switch this row labels (Toggle `id`). */
    for?: string | null;
    /** A row of a form: the label in the size of every control label there (13/500). */
    form?: boolean;
    testid?: string | null;
    children: Snippet;
  }

  let {
    label = null,
    hint = null,
    badges = null,
    lead = null,
    dot = null,
    copy = false,
    copyLabel = false,
    for: control = null,
    form = false,
    testid = null,
    children,
  }: Props = $props();

  describe(() => (control !== null && hint ? `${control}-hint` : null));

  /** A path in its parts, each with the separator it ends on ("/" or "\"): it breaks only
   *  there, never at a hyphen or a space of a folder's name. */
  const parts = (path: string): string[] => path.match(/[^/\\]*[/\\]|[^/\\]+$/g) ?? [path];
</script>

<div
  class="row"
  data-setting-row
  data-toggle-row={control !== null ? '' : undefined}
  data-testid={testid ?? undefined}
>
  {#if lead}<span class="lead">{@render lead()}</span>{/if}
  <div class="text">
    {#if label !== null || badges}
      <span class="title">
        {#if label !== null}<span
            class="label"
            class:form
            class:path={copyLabel}
            id={control !== null ? `${control}-label` : undefined}
            data-copy={copyLabel ? '' : undefined}>{label}</span
          >{/if}
        {#if badges}{@render badges()}{/if}
      </span>
    {/if}
    {#if hint}<p
        class="hint"
        class:path={copy}
        class:status={dot !== null}
        id={control !== null ? `${control}-hint` : undefined}
        data-copy={copy ? '' : undefined}
      >
        {#if dot}<span class="dot {dot}" aria-hidden="true"></span>{/if}
        {#if copy}{#each parts(hint) as part, index (index)}{#if index > 0}<wbr />{/if}<span
              class="part">{part}</span
            >{/each}{:else}{hint}{/if}
      </p>{/if}
  </div>
  <div class="control">{@render children()}</div>
</div>

<style>
  .row {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-24);
    min-height: calc(var(--control-md) + 2 * var(--space-12));
    margin-inline: calc(-1 * var(--row-inset));
    padding: var(--space-12) var(--row-inset);
    border-bottom: var(--border-width) solid var(--border);
    isolation: isolate;
  }

  .row:last-child {
    border-bottom: 0;
  }

  .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .title {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-8);
  }

  .label {
    color: var(--text);
    font: var(--type-md);
    font-weight: var(--weight-medium);
  }

  .label.form {
    font: var(--type-sm);
    font-weight: var(--weight-medium);
  }

  .hint {
    color: var(--text-muted);
    font: var(--type-sm);
  }

  /* The tile stands 12 from the text (the row's other parts keep its 24). */
  .lead {
    display: inline-flex;
    flex: none;
    margin-inline-end: calc(var(--space-12) - var(--space-24));
  }

  .hint.status {
    display: flex;
    align-items: center;
    gap: var(--space-6);
  }

  .dot {
    flex: none;
    width: var(--dot-unread);
    height: var(--dot-unread);
    border-radius: var(--radius-full);
  }

  .dot.success {
    background-color: var(--success);
  }

  .dot.danger {
    background-color: var(--danger);
  }

  .path {
    overflow-wrap: anywhere;
  }

  /* A part of a path is kept whole and moves to the next line as one; only a part wider than
     the whole line breaks inside. */
  .part {
    display: inline-block;
    max-width: 100%;
  }

  .control {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-12);
  }

  /* A ghost button at the end lines its text up with the edge, like toggles and bordered
     buttons (the ghost's own padding would inset it). */
  .control :global(.btn.ghost.sm:last-child) {
    margin-right: calc(-1 * var(--ghost-inset));
  }

  /* In a narrow container (the settings page at the minimum window) the control goes under
     the text only where the two do not fit side by side (the text keeps at least a column's
     width, so a path keeps room to read); a switch stays at the right. */
  @container (width < 520px) {
    .row:not([data-toggle-row]) {
      flex-wrap: wrap;
      row-gap: var(--space-8);
    }

    .row:not([data-toggle-row]) .text {
      flex: 1 1 var(--stat-min);
    }

    /* The buttons wrap within the row's width rather than run past its edge. */
    .row:not([data-toggle-row]) .control {
      max-width: 100%;
      margin-left: auto;
    }
  }
</style>
