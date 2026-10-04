// The tab Einstellungen shows: Portale (what the search asks for, the portals it searches, the
// alert mails) and Daten (user decision 2026-10-03). Zurück and Vor walk them
// (history.svelte.ts); a way into Einstellungen for one thing (the mailbox, a portal) opens
// Portale.

export const SETTINGS_TABS = ['portals', 'data'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const settingsTab = $state<{ value: SettingsTab }>({ value: SETTINGS_TABS[0] });
