<!--
  The one row of a list in a page's box (Einstellungen: a portal, the mailbox, the profile's
  folder, the reset; the round 10 draft): 12 20 inside and 62 high whether or not a line
  stands under its name (12 + 20 + 18 + 12, so a list keeps one rhythm), its name (14/540
  ink) and the one line under it (13 muted), then its buttons (`children`: outlined, each with
  its glyph, 8 apart; a pair, `pair`, in two columns of one width, the wider label's) and what
  always ends the row (`end`: a portal's switch). No tile: the
  name says it. The buttons and the switch are centred on the name and its line, and lines
  that unfold under the text (`notes`: a portal's problem) move nothing beside it. Between
  rows a hairline that starts at the text (20 in, like the Profil's), the only lines of a box.
  No wash under the pointer: a row is not a control (CLAUDE.md).
  The line under the name is quiet; a value to copy (a path, in the line's font) selects like
  text (`copy`; it breaks only after a separator), and so does a name that is such a value
  (`copyLabel`, the address of the mailbox). A state is a status word (`status`, StatusText:
  a dot and the word in its colour). Its test id is the row's with `-hint`. A row that cannot be used now (`disabled`: an alert portal without a mailbox) dims its name.
  With `for` (the id of its switch) the row works like a row of the system settings of
  Windows 11 and macOS: only the switch switches (user decision). The name names the switch
  and the line describes it (`{for}-label`, and `{for}-hint` while there is one, read by
  Toggle), but neither is a click target.
  In a narrow box (the smallest window) the buttons go to a line of their own at the row's
  end; the text keeps its room and `end` stays at the right. Buttons that come and go there
  together (foldAside) open and close their line, so the rows below glide.
-->
<script lang="ts">
  import { describe } from '$lib/state/described';
  import type { Snippet } from 'svelte';
  import StatusText, { type StatusTone } from './StatusText.svelte';

  interface Props {
    label: string;
    hint?: string | null;
    /** The line is a state: a dot and the word in the state's colour. */
    status?: StatusTone | null;
    /** The hint is a value a user would copy (a folder path). */
    copy?: boolean;
    /** The label is a value a user would copy (the address of the mailbox). */
    copyLabel?: boolean;
    /** The row cannot be used now: its name stands in the muted grey. */
    disabled?: boolean;
    /** The id of the switch this row labels (Toggle `id`). */
    for?: string | null;
    /** Lines under the text that come and go (a portal's problem). */
    notes?: Snippet | null;
    /** What ends the row whatever the width (the switch). */
    end?: Snippet | null;
    testid?: string | null;
    /** The row's buttons are a pair: both as wide as the wider. */
    pair?: boolean;
    /** The row's buttons. */
    children?: Snippet;
  }

  let {
    label,
    hint = null,
    status = null,
    copy = false,
    copyLabel = false,
    disabled = false,
    for: control = null,
    notes = null,
    end = null,
    testid = null,
    pair = false,
    children,
  }: Props = $props();

  describe(() => (control !== null && hint ? `${control}-hint` : null));

  /** A path in its parts, each with the separator it ends on ("/" or "\"): it breaks only
   *  there, never at a hyphen or a space of a folder's name. */
  const parts = (path: string): string[] => path.match(/[^/\\]*[/\\]|[^/\\]+$/g) ?? [path];
</script>

<div class="row" class:disabled data-setting-row data-testid={testid ?? undefined}>
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
        id={control !== null ? `${control}-hint` : undefined}
        data-copy={copy ? '' : undefined}
        data-testid={testid ? `${testid}-hint` : undefined}
      >
        {#if status}<StatusText
            tone={status}
            text={hint}
          />{:else if copy}{#each parts(hint) as part, index (index)}{#if index > 0}<wbr
              />{/if}<span class="part">{part}</span>{/each}{:else}{hint}{/if}
      </p>{/if}
    {#if notes}{@render notes()}{/if}
  </div>
  {#if children}
    <div class="actions">
      {#if pair}<div class="pair">{@render children()}</div>{:else}{@render children()}{/if}
    </div>
  {/if}
  {#if end}<div class="end">{@render end()}</div>{/if}
</div>

<style>
  /* The buttons and the switch stand on a line as high as the name and its line, so lines
     unfolding under the text move nothing beside it. */
  .row {
    --line-box: calc(var(--setting-row-min) - 2 * var(--setting-row-pad-y));

    position: relative;
    display: flex;
    align-items: flex-start;
    column-gap: var(--setting-row-gap);
    min-height: var(--setting-row-min);
    padding: var(--setting-row-pad-y) var(--card-pad-x);
  }

  /* The hairline between rows starts at the text. */
  :global([data-setting-row]) + .row::before {
    position: absolute;
    top: 0;
    right: 0;
    left: var(--setting-rule-start);
    border-top: var(--border-width) solid var(--border);
    content: '';
  }

  .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    justify-content: center;
    min-width: 0;
    min-height: var(--line-box);
  }

  .label {
    color: var(--text);
    font: var(--type-label);
  }

  .hint {
    color: var(--text-muted);
    font: var(--type-sm);
  }

  /* A row out of use: the name steps back to its line's grey, the line stays the second. */
  .disabled .label {
    color: var(--text-muted);
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

  .actions,
  .end {
    display: flex;
    flex: none;
    gap: var(--space-8);
    height: var(--line-box);
  }

  .end {
    align-items: center;
  }

  /* The buttons hang from the top of their line, in its middle: what closes a line under them
     (foldAside) moves nothing while its height is fixed. */
  .actions {
    align-items: flex-start;
  }

  .actions :global(button) {
    margin-top: calc((var(--line-box) - var(--control-field)) / 2);
  }

  /* A pair: columns of one width, each as wide as the wider button. */
  .pair {
    display: grid;
    grid-auto-columns: 1fr;
    grid-auto-flow: column;
    gap: var(--space-8);
    width: max-content;
  }

  /* A row whose buttons are all away (a portal without calls, a pair while its form stands open)
     keeps no room for them: no gap beside the text, and no empty line under it in a narrow box. */
  .actions:not(:has(button)) {
    display: none;
  }

  /* In a narrow box the buttons take a line of their own at the row's end (they wrap within
     its width rather than run past its edge); the text keeps its room, `end` its place. */
  @container (width < 480px) {
    .row {
      flex-wrap: wrap;
    }

    .actions {
      order: 1;
      flex-wrap: wrap;
      row-gap: 0;
      justify-content: flex-end;
      width: 100%;
      height: auto;
      overflow: hidden;
    }

    /* The gap above the line is its buttons', so a line that closes under them takes it along. */
    .actions :global(button) {
      margin-top: var(--space-8);
    }
  }
</style>
