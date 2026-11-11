// Finds the English phrases the code passes to <T> and tr(), for the coverage test.
const ENTITIES: Record<string, string> = {
  "&apos;": "'",
  "&quot;": '"',
  "&amp;": "&",
  "&ldquo;": "“",
  "&rdquo;": "”",
  "&lsquo;": "‘",
  "&rsquo;": "’",
  "&nbsp;": " ",
  "&hellip;": "…",
  "&mdash;": "—",
  "&ndash;": "–",
};

const decode = (text: string) =>
  text.replace(/&\w+;/g, (entity) => ENTITIES[entity] ?? entity);

const unquote = (literal: string) => JSON.parse(literal) as string;

export function scanPhrases(source: string): string[] {
  const found: string[] = [];
  // <T>Plain text</T>, possibly over several lines
  for (const m of source.matchAll(/<T>([^<>{}]+)<\/T>/g))
    found.push(decode(m[1].replace(/\s+/g, " ").trim()));
  // <T>{"text"}</T> and <T vars={{ ... }}>{"text"}</T>
  for (const m of source.matchAll(
    /<T(?:\s+vars=\{\{[^}]*\}\})?\s*>\s*\{\s*("(?:[^"\\]|\\.)*")\s*\}\s*<\/T>/g,
  ))
    found.push(unquote(m[1]));
  // tr("text") and (await getTr())("text")
  for (const m of source.matchAll(
    /(?:\btr|getTr\(\)\))\(\s*("(?:[^"\\]|\\.)*")/g,
  ))
    found.push(unquote(m[1]));
  return found;
}
