<!--
  A state in a word (the line of a row in Einstellungen: Verbunden, Pausiert bis morgen, Abgelehnt):
  a 7 px dot, then the word, both in the state's one colour (the uniformity audit, 2026-10-29).
  Three tones: success (green), warning (yellow) and danger (red). The dot is the only dot of a
  page; it says nothing a screen reader needs (the word says it).
-->
<script lang="ts" module>
  export type StatusTone = 'success' | 'warning' | 'danger';
</script>

<script lang="ts">
  interface Props {
    tone: StatusTone;
    text: string;
    testid?: string | null;
  }

  let { tone, text, testid = null }: Props = $props();
</script>

<span class="status {tone}" data-testid={testid ?? undefined}
  ><span class="dot" aria-hidden="true"></span>{text}</span
>

<style>
  /* On top of its line: the line stays as high as a plain one, and so does its row. */
  .status {
    display: inline-flex;
    align-items: center;
    vertical-align: top;
    gap: var(--space-6);
    color: var(--status-color);
    font: var(--status);
  }

  .dot {
    flex: none;
    width: var(--dot-status);
    height: var(--dot-status);
    border-radius: var(--radius-full);
    background-color: var(--status-color);
  }

  .success {
    --status-color: var(--status-success);
  }

  .warning {
    --status-color: var(--status-warning);
  }

  .danger {
    --status-color: var(--status-danger);
  }
</style>
