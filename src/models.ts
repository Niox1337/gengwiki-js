/** What the API returns, as plain objects. Unknown fields are dropped so a newer server never breaks an older SDK. */

type Raw = Record<string, unknown>;

/** Every field of defaults, taken from raw when raw has it. */
function pick<T extends object>(defaults: T, raw: Raw): T {
  const out = { ...defaults } as Record<string, unknown>;
  for (const k of Object.keys(defaults)) {
    if (raw[k] !== undefined) out[k] = raw[k];
  }
  return out as T;
}

/** One reply's rolls, what the model may do unasked, and the text that tells it so. */
export interface Turn {
  prompt: string;
  memes: boolean;
  quotes: boolean;
  stickers: boolean;
  /** Set on the first turn of a client without a key, for the host to show the person running it. */
  notice: string;
}

export interface MemeSummary {
  slug: string;
  title: string;
  aliases: string[];
  summary: string;
  usage_scenario: string;
  categories: string[];
  heat: number;
  updated_at: string;
}

export interface Contributor {
  name: string;
  edits: number;
  avatar_id: string | null;
}

export interface Meme extends MemeSummary {
  id: string;
  body: string;
  usage_examples: string[];
  first_seen: string | null;
  related: MemeSummary[];
  contributors: Contributor[];
}

export interface ChatMessage {
  role: "system";
  content: string;
}

export interface Persona {
  id: string;
  title: string;
  description: string;
  prompt: string;
  tags: string[];
  /** Only the catalog sends these, a key's own persona does not. */
  author: string | null;
  memes: Raw[];
  packs: Raw[];
  people: Raw[];
  /** The system message for any chat completions style API. */
  asMessage(): ChatMessage;
}

export interface Sticker {
  id: string;
  caption: string;
  url: string;
  pack_id: string;
  pack_title: string;
}

export interface StickerPack {
  id: string;
  title: string;
  description: string;
  tags: string[];
  stickers: Sticker[];
}

export interface Person {
  id: string;
  name: string;
  aliases: string[];
  tags: string[];
  bio: string;
  quotes: string[];
  /** Only one person looked up by client.person() has these, the memes that name them. */
  memes: Raw[];
}

export interface Lexicon {
  id: string;
  name: string;
  description: string;
  visibility: string;
  entries: number;
}

export interface LexiconEntry {
  id: string;
  term: string;
  aliases: string[];
  note: string;
  tags: string[];
}

export interface Tag {
  name: string;
  count: number;
}

/** What a key can do right now. missing holds the scopes it lacks, stale means the wiki is out of reach and this is the old copy. */
export interface Status {
  persona: string;
  memes: number;
  stickers: number;
  people: number;
  quotes: number;
  missing: string[];
  stale: boolean;
}

export interface RateLimit {
  per_minute: number | null;
  per_day: number | null;
  used_this_minute: number;
  used_today: number;
  reset_secs: number;
}

/** A key as the account API describes it. The secret is never part of this. */
export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  memes: Raw[];
  persona: Raw | null;
  packs: Raw[];
  people: Raw[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

/** A key saved on this machine. The secret stays in the keyring. */
export interface LocalKey {
  name: string;
  prefix: string;
  id: string | null;
  persona_id: string | null;
  persona_title: string | null;
  current: boolean;
}

const summaryDefaults = (): MemeSummary => ({
  slug: "",
  title: "",
  aliases: [],
  summary: "",
  usage_scenario: "",
  categories: [],
  heat: 0,
  updated_at: "",
});

export const toMemeSummary = (raw: Raw): MemeSummary => pick(summaryDefaults(), raw);

export const toContributor = (raw: Raw): Contributor => pick({ name: "", edits: 0, avatar_id: null as string | null }, raw);

export function toMeme(raw: Raw): Meme {
  const meme = pick<Omit<Meme, "related" | "contributors">>(
    { ...summaryDefaults(), id: "", body: "", usage_examples: [], first_seen: null },
    raw,
  );
  return {
    ...meme,
    related: ((raw.related as Raw[] | undefined) ?? []).map(toMemeSummary),
    contributors: ((raw.contributors as Raw[] | undefined) ?? []).map(toContributor),
  };
}

export function toPersona(raw: Raw): Persona {
  const persona = pick<Omit<Persona, "asMessage">>(
    { id: "", title: "", description: "", prompt: "", tags: [], author: null, memes: [], packs: [], people: [] },
    raw,
  );
  // Not enumerable, so the persona still serializes as plain data.
  Object.defineProperty(persona, "asMessage", {
    value(this: Persona): ChatMessage {
      return { role: "system", content: this.prompt };
    },
  });
  return persona as Persona;
}

export const toSticker = (raw: Raw): Sticker => pick({ id: "", caption: "", url: "", pack_id: "", pack_title: "" }, raw);

export function toStickerPack(raw: Raw): StickerPack {
  const pack = pick<Omit<StickerPack, "stickers">>({ id: "", title: "", description: "", tags: [] }, raw);
  const stickers = ((raw.stickers as Raw[] | undefined) ?? []).map((s) => toSticker({ ...s, pack_id: pack.id, pack_title: pack.title }));
  return { ...pack, stickers };
}

export const toPerson = (raw: Raw): Person =>
  pick({ id: "", name: "", aliases: [], tags: [], bio: "", quotes: [], memes: [] } as Person, raw);

export const toLexicon = (raw: Raw): Lexicon => pick({ id: "", name: "", description: "", visibility: "", entries: 0 }, raw);

export const toLexiconEntry = (raw: Raw): LexiconEntry => pick({ id: "", term: "", aliases: [], note: "", tags: [] } as LexiconEntry, raw);

export const toTag = (raw: Raw): Tag => pick({ name: "", count: 0 }, raw);

export const toRateLimit = (raw: Raw): RateLimit =>
  pick({ per_minute: null, per_day: null, used_this_minute: 0, used_today: 0, reset_secs: 0 } as RateLimit, raw);

export const toApiKey = (raw: Raw): ApiKey =>
  pick(
    {
      id: "",
      name: "",
      prefix: "",
      scopes: [],
      memes: [],
      persona: null,
      packs: [],
      people: [],
      created_at: "",
      last_used_at: null,
      revoked_at: null,
    } as ApiKey,
    raw,
  );
