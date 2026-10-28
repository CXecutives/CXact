<!--
  A state in a word (the line of a row in Einstellungen: Verbunden, Pausiert bis morgen, Abgelehnt):
  a 7 px dot in the state's exact colour, then the word in the same hue one step darker, so a
  yellow or a green word reads on white (decision 4, 2026-10-24). Three tones: success (green),
  warning (yellow) and danger (red). The dot is the only dot of a page; it says nothing a
  screen reader needs (the word says it).
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
  .status {
    display: inline-flex;
    align-items: center;
    gap: var(--space-6);
    color: var(--status-text);
    font: var(--status);
  }

  .dot {
    flex: none;
    width: var(--dot-status);
    height: var(--dot-status);
    border-radius: var(--radius-full);
    background-color: var(--status-dot);
  }

  .success {
    --status-dot: var(--status-success);
    --status-text: var(--status-success-text);
  }

  .warning {
    --status-dot: var(--status-warning);
    --status-text: var(--status-warning-text);
  }

  .danger {
    --status-dot: var(--status-danger);
    --status-text: var(--status-danger-text);
  }
</style>
