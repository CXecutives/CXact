// The tab Einstellungen shows: Suche, Postfach, Daten, like the Profil's tabs (user decision
// 2026-10-01), one card or two each. Zurück and Vor walk them (history.svelte.ts); a way
// into Einstellungen for one thing (the mailbox, a source) opens its tab.

export const SETTINGS_TABS = ['search', 'mailbox', 'data'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const settingsTab = $state<{ value: SettingsTab }>({ value: SETTINGS_TABS[0] });
