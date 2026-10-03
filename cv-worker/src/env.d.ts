// The system prompt is bundled as a text module (wrangler.toml, [[rules]]).
declare module '*.md' {
  const text: string;
  export default text;
}
