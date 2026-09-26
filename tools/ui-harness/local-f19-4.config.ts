// Temporary (never committed): the harness with its build in a folder of this checkout's
// own, so parallel worktrees sharing node_modules never test each other's build.
import base from './playwright.config';

const out =
  'C:/Users/jarru/AppData/Local/Temp/claude/C--Users-jarru-Documents-Claude-WebView-TEST/2e488c4f-41c6-4c1c-9e06-dc7eb1c2f104/scratchpad/harness-f19-4';

export default {
  ...base,
  webServer: {
    ...(base.webServer as object),
    command: `npx vite build ui --mode harness --outDir ${out} --emptyOutDir && npx vite preview ui --mode harness --outDir ${out}`,
  },
};
