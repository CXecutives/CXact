<!--
  The one row of a list in a page's box (Einstellungen: a portal, the mailbox, the profile's
  folder, the reset; the setup's Alert-Mails): its tile (`lead`, 10 from its text), its label
  and one line under it, then its buttons (`children`: outlined, each with its glyph, 8
  apart) and what always ends the row (`end`: a portal's icon link and its switch, the switch
  last). Every row is 12 above and below its line, which is as high as a label and its line
  (--row-line): the tile, the buttons and the switch are centred on it, so a list keeps one
  rhythm whether a row has its line or not, and lines that unfold under the text (`notes`: a
  portal's problem) move nothing beside it. The row runs edge to edge in its box and pads its
  content by the box's --row-inset, so its hairline (between rows only) and its text share the
  box's grid.
  The line under the label is quiet; a value to copy (a path) selects like text (`copy`; it
  breaks only after a separator), and so does a label that is such a value (`copyLabel`, the
  address of the mailbox). A dot before it says a state (`dot`: Verbunden green, a failure
  red); in the warning's ink it says what the row needs first (`waits`: a portal of alert mails
  without a mailbox). Its test id is the row's with `-hint`.
  With `for` (the id of its switch) the row works like a row of the system settings of
  Windows 11 and macOS: only the switch switches (user decision). The label names the switch
  and the line describes it (`{for}-label`, and `{for}-hint` while there is one, read by
  Toggle), but neither is a click target, and the row never reacts to the pointer.
  In a narrow box (the minimum window) the buttons go to a line of their own at the row's end;
  the text keeps its room and `end` stays at the right.
-->
<script lang="ts">
  import { describe } from '$lib/state/described';
  import type { Snippet } from 'svelte';

  interface Props {
    label: string;
    hint?: string | null;
    /** The tile before the text. */
    lead: Snippet;
    /** A dot before the hint that says a state (connected, or a failure). */
    dot?: 'success' | 'danger' | null;
    /** The hint in the warning's ink: what the row needs first. */
    waits?: boolean;
    /** The hint is a value a user would copy (a folder path). */
    copy?: boolean;
    /** The label is a value a user would copy (the address of the mailbox). */
    copyLabel?: boolean;
    /** The id of the switch this row labels (Toggle `id`). */
    for?: string | null;
    /** Lines under the text that come and go (a portal's problem). */
    notes?: Snippet | null;
    /** What ends the row whatever the width (an icon link, the switch). */
    end?: Snippet | null;
    testid?: string | null;
    /** The row's buttons. */
    children?: Snippet;
  }

  let {
    label,
    hint = null,
    lead,
    dot = null,
    waits = false,
    copy = false,
    copyLabel = false,
    for: control = null,
    notes = null,
    end = null,
    testid = null,
    children,
  }: Props = $props();

  describe(() => (control !== null && hint ? `${control}-hint` : null));

  /** A path in its parts, each with the separator it ends on ("/" or "\"): it breaks only
   *  there, never at a hyphen or a space of a folder's name. */
  const parts = (path: string): string[] => path.match(/[^/\\]*[/\\]|[^/\\]+$/g) ?? [path];
</script>

<div class="row" data-setting-row data-testid={testid ?? undefined}>
  <span class="lead">{@render lead()}</span>
  <div class="text">
    <span
      class="label"
      class:path={copyLabel}
      id={control !== null ? `${control}-label` : undefined}
      data-copy={copyLabel ? '' : undefined}>{label}</span
    >
    {#if hint}<p
        class="hint"
        class:path={copy}
        class:status={dot !== null}
        class:waits
        id={control !== null ? `${control}-hint` : undefined}
        data-copy={copy ? '' : undefined}
        data-testid={testid ? `${testid}-hint` : undefined}
      >
        {#if dot}<span class="dot {dot}" aria-hidden="true"
          ></span>{/if}{#if copy}{#each parts(hint) as part, index (index)}{#if index > 0}<wbr
              />{/if}<span class="part">{part}</span>{/each}{:else}{hint}{/if}
      </p>{/if}
    {#if notes}{@render notes()}{/if}
  </div>
  {#if children}<div class="actions">{@render children()}</div>{/if}
  {#if end}<div class="end">{@render end()}</div>{/if}
</div>

<style>
  .row {
    display: flex;
    align-items: flex-start;
    gap: var(--space-8) var(--space-16);
    margin-inline: calc(-1 * var(--row-inset));
    padding: var(--row-pad) var(--row-inset);
    border-bottom: var(--border-width) solid var(--border);
  }

  .row:last-child {
    border-bottom: 0;
  }

  /* The tile stands 10 from the text (the row's other parts keep their 16). */
  .lead {
    display: flex;
    flex: none;
    align-items: center;
    height: var(--row-line);
    margin-inline-end: calc(var(--space-10) - var(--space-16));
  }

  /* Label and line 2 apart, centred on the row's line. */
  .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-2);
    min-width: 0;
    min-height: var(--row-line);
  }

  .label {
    color: var(--text);
    font: var(--type-label);
  }

  .hint {
    color: var(--text-muted);
    font: var(--type-sm);
  }

  .hint.waits {
    color: var(--warning-text);
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

  /* A path to copy in the system's monospace, small. */
  .hint.path {
    font: var(--type-mono);
  }

  /* A part of a path is kept whole and moves to the next line as one; only a part wider than
     the whole line breaks inside. */
  .part {
    display: inline-block;
    max-width: 100%;
  }

  .actions,
  .end {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-8);
    height: var(--row-line);
  }

  /* A row whose buttons are all away (a portal without calls) keeps no room for them: no gap
     beside the text, and no empty line under it in a narrow box. */
  .actions:not(:has(*)) {
    display: none;
  }

  /* In a narrow box the buttons take a line of their own at the row's end (they wrap within
     its width rather than run past its edge); the text keeps its room, `end` its place. */
  @container (width < 520px) {
    .row {
      flex-wrap: wrap;
    }

    .actions {
      order: 1;
      flex-wrap: wrap;
      justify-content: flex-end;
      width: 100%;
      height: auto;
    }
  }
</style>
