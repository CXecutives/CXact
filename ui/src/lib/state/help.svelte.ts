// The card of the keys (features/shell/KeysHelp.svelte): Ctrl+/ or Cmd+/ opens it from
// anywhere (lib/input/input.ts), the same keys, Esc or its button close it.

class Help {
  open = $state(false);

  show(): void {
    this.open = true;
  }

  hide(): void {
    this.open = false;
  }
}

export const help = new Help();
