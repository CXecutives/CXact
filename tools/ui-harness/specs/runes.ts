// The catalog (ui/src/lib/i18n/de.ts) reads the app's language from a Svelte store, whose
// `$state` the Svelte compiler replaces in the app. The harness imports the catalog as plain
// TypeScript: here `$state` is simply its value. Imported before the catalog (helpers.ts).

(globalThis as Record<string, unknown>)['$state'] ??= <T>(value: T): T => value;

export {};
