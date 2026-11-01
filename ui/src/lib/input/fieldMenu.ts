// The menu of a text field, like the OS's own, its entries enabled by the field's state. input.ts
// opens it (a right click, the Menu key, Shift+F10) and owns every listener; this file only says
// what the entries are and what they do.

import { t } from '../i18n/t';
import { clipboardText, reportUiError } from '../ipc/api';
import { fieldMenuUndoDelete } from '../platform';
import type { MenuEntry } from '../state/menu.svelte';

/** The Delete entry of a field's menu: the selection goes, as one step of the field's undo. */
function deleteSelection(field: HTMLInputElement | HTMLTextAreaElement): void {
  field.focus();
  // The editing command keeps the step in the field's own undo (setRangeText would not).
  if (document.execCommand('delete')) return;
  field.setRangeText('', field.selectionStart ?? 0, field.selectionEnd ?? 0, 'end');
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

/** A paste from the menu is the key's: the field's own rule first (a tag field makes a list into
 *  chips, ChipInput), else the text is typed in as one step of the field's undo. */
function pasteInto(field: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const clipboardData = new DataTransfer();
  clipboardData.setData('text', text);
  const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData });
  if (!field.dispatchEvent(paste) || document.execCommand('insertText', false, text)) return;
  field.setRangeText(text, field.selectionStart ?? 0, field.selectionEnd ?? 0, 'end');
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Put text on the clipboard (the engine's copy first, the clipboard API when it refuses). */
export function copyOut(text: string): void {
  if (document.execCommand('copy')) return;
  navigator.clipboard.writeText(text).catch((error: unknown) => {
    reportUiError(`menu copy: ${String(error)}`, null, null);
  });
}

const SEPARATOR: MenuEntry = { kind: 'separator' };

/**
 * The menu of a text field, like the OS's own, its entries enabled by the field's state.
 * Windows: Undo | Cut, Copy, Paste, Delete | Select all; macOS has no undo and no delete
 * there (platform.ts). The menu takes the focus while it is open; an entry puts it back on
 * the field with the selection it had, then acts like the key would.
 */
export function fieldMenu(field: HTMLInputElement | HTMLTextAreaElement): MenuEntry[] {
  // A right click in a field that is not focused focuses it (the commands act on it).
  if (document.activeElement !== field) field.focus();
  const start = field.selectionStart ?? 0;
  const end = field.selectionEnd ?? 0;
  const back = (): void => {
    field.focus({ preventScroll: true });
    field.setSelectionRange(start, end);
  };
  const editable = !field.readOnly && !field.disabled;
  const hidden = field instanceof HTMLInputElement && field.type === 'password';
  const selected = start !== end;
  const full = fieldMenuUndoDelete();
  const undo: MenuEntry[] = full
    ? [
        {
          id: 'undo',
          label: t.edit.undo,
          icon: 'undo',
          // The engine keeps one undo history for the page.
          disabled: !(editable && canUndo()),
          run: () => {
            back();
            document.execCommand('undo');
          },
        },
        SEPARATOR,
      ]
    : [];
  const remove: MenuEntry[] = full
    ? [
        {
          id: 'delete',
          label: t.edit.delete,
          icon: 'delete',
          disabled: !(editable && selected),
          run: () => {
            back();
            deleteSelection(field);
          },
        },
      ]
    : [];
  const text = field.value.slice(start, end);
  return [
    ...undo,
    {
      id: 'cut',
      label: t.edit.cut,
      icon: 'cut',
      disabled: !(editable && selected && !hidden),
      run: () => {
        back();
        if (document.execCommand('cut')) return;
        copyOut(text);
        deleteSelection(field);
      },
    },
    {
      id: 'copy',
      label: t.edit.copy,
      icon: 'copy',
      disabled: !(selected && !hidden),
      run: () => {
        back();
        copyOut(text);
      },
    },
    {
      id: 'paste',
      label: t.edit.paste,
      icon: 'paste',
      disabled: !editable,
      run: () => {
        back();
        void clipboardText().then((pasted) => {
          if (pasted === null || pasted === '' || !field.isConnected) return;
          back();
          pasteInto(field, pasted);
        });
      },
    },
    ...remove,
    SEPARATOR,
    {
      id: 'select-all',
      label: t.edit.selectAll,
      icon: 'selectAll',
      disabled: field.value === '',
      run: () => {
        field.focus({ preventScroll: true });
        field.select();
      },
    },
  ];
}

/** The page has an edit to take back (greys out the Undo entry otherwise, like the OS). */
function canUndo(): boolean {
  try {
    return document.queryCommandEnabled('undo');
  } catch {
    return true;
  }
}
