/** The server's search, run locally, so a synced key answers without a request. */

export type Row = Record<string, any>;

const WORD = /[\p{L}\p{N}]+/gu;

/** Runs of whitespace as one space, trimmed. */
export const squash = (text: string): string => text.split(/\s+/).filter(Boolean).join(" ");

/** Three-character pieces of the lowercased alphanumeric words, each word padded with two spaces in front and one behind. */
function trigrams(text: string): Set<string> {
  const grams = new Set<string>();
  for (const word of text.toLowerCase().match(WORD) ?? []) {
    const padded = Array.from(`  ${word} `);
    for (let i = 0; i + 3 <= padded.length; i++) grams.add(padded.slice(i, i + 3).join(""));
  }
  return grams;
}

export function similarity(a: string, b: string): number {
  const ga = trigrams(a);
  const gb = trigrams(b);
  if (!ga.size || !gb.size) return 0;
  let shared = 0;
  for (const g of ga) if (gb.has(g)) shared++;
  return shared / (ga.size + gb.size - shared);
}

/** Same match and order as common::memes::search. The title and aliases are scored, the usage scenario only has to contain q. */
export function searchMemes(q: string, rows: Row[], limit: number): Row[] {
  q = q.trim();
  if (!q) return rows.slice(0, limit);
  const low = q.toLowerCase();
  const scored: [number, Row][] = [];
  for (const r of rows) {
    const text = [r.title, ...r.aliases].join(" ");
    const sim = similarity(text, q);
    if (`${text} ${r.usage_scenario ?? ""}`.toLowerCase().includes(low) || sim > 0.2) scored.push([sim, r]);
  }
  scored.sort((a, b) => b[0] - a[0] || b[1].heat - a[1].heat);
  return scored.slice(0, limit).map(([, r]) => r);
}

/** The reverse of searchMemes, the memes whose title or alias is written in the text. The longest name wins. */
export function matchMemes(text: string, rows: Row[], limit: number): Row[] {
  text = text.toLowerCase();
  const scored: [number, Row][] = [];
  for (const r of rows) {
    // One character aliases would match nearly any sentence.
    const names = [r.title, ...r.aliases].filter((n: string) => n.length >= 2 && text.includes(n.toLowerCase()));
    const longest = Math.max(0, ...names.map((n: string) => n.length));
    if (longest) scored.push([longest, r]);
  }
  scored.sort((a, b) => b[0] - a[0] || b[1].heat - a[1].heat);
  return scored.slice(0, limit).map(([, r]) => r);
}

/**
 * Same match as the API's strpos over the caption, the pack title and the pack tags.
 *
 * A host asking for one sticker by caption wants that sticker, so the exact caption comes first, then captions containing q, then the rest, each in pack order.
 * Runs of whitespace count as one space, a model copying a caption tends to flatten them.
 */
export function searchStickers(q: string, packs: Row[], limit: number): Row[] {
  q = squash(q).toLowerCase();
  const found: [number, Row][] = [];
  for (const p of packs) {
    for (const s of p.stickers) {
      const caption = squash(s.caption).toLowerCase();
      if ([caption, p.title, ...p.tags].join(" ").toLowerCase().includes(q)) {
        const rank = caption === q ? 0 : caption.includes(q) ? 1 : 2;
        found.push([rank, { ...s, pack_id: p.id, pack_title: p.title }]);
      }
    }
  }
  found.sort((a, b) => a[0] - b[0]);
  return found.slice(0, limit).map(([, s]) => s);
}

/** Same match as the catalog's strpos over the title, the description and the tags. */
export function searchPersonas(q: string, rows: Row[]): Row[] {
  q = q.trim().toLowerCase();
  return rows.filter((r) => [r.title, r.description ?? "", ...(r.tags ?? [])].join(" ").toLowerCase().includes(q));
}

/** Same match as the API's strpos over the name, aliases, tags, bio and quotes. */
export function searchPeople(q: string, rows: Row[]): Row[] {
  q = q.trim().toLowerCase();
  return rows.filter((r) => [r.name, ...r.aliases, ...r.tags, r.bio, ...r.quotes].join(" ").toLowerCase().includes(q));
}

export function searchEntries(q: string, entries: Row[], limit: number): Row[] {
  q = q.trim().toLowerCase();
  return entries.filter((e) => [e.term, ...e.aliases, e.note, ...e.tags].join(" ").toLowerCase().includes(q)).slice(0, limit);
}
