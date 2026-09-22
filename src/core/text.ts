/** Text normalisation helpers shared by sources, matching and enrichment. */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ccedil: "ç",
  pound: "£",
  euro: "€",
  bull: "•",
  middot: "·",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

/** Strip tags and collapse whitespace, keeping paragraph breaks readable. */
export function htmlToText(html: string): string {
  if (!html) return "";
  return decodeEntities(
    html
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .replace(/^[ \t]+|[ \t]+$/gm, "")
    .trim();
}

/** Lowercase, strip accents and punctuation — for fuzzy key building. */
export function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

/** Words that add no identity to a school name when deduplicating. */
const SCHOOL_STOPWORDS = new Set([
  "the", "school", "schools", "international", "academy", "college", "campus",
  "private", "british", "american", "of", "and", "for", "group", "education",
  "educational", "institute", "ltd", "llc",
]);

/**
 * A stable key for "is this the same school?" across boards. Drops generic
 * words so "The British School of Beijing" and "British School Beijing" agree.
 */
export function schoolKey(name: string, country?: string): string {
  const core = slugify(name)
    .split("-")
    .filter((w) => w && !SCHOOL_STOPWORDS.has(w))
    .join("-");
  const base = core || slugify(name);
  return country ? `${base}|${slugify(country)}` : base;
}

const REGION_NAMES = new Intl.DisplayNames(["en"], { type: "region" });

/** Turn an ISO-3166 alpha-2 code into a display name; pass through otherwise. */
export function countryName(input?: string): string | undefined {
  if (!input) return undefined;
  const t = input.trim();
  if (/^[A-Za-z]{2}$/.test(t)) {
    try {
      const name = REGION_NAMES.of(t.toUpperCase());
      if (name && name !== t.toUpperCase()) return name;
    } catch {
      /* not a region code */
    }
  }
  return t;
}

/** Best-effort ISO alpha-2 for a country name, using Intl as the dictionary. */
let countryIndex: Map<string, string> | null = null;
export function countryCode(input?: string): string | undefined {
  if (!input) return undefined;
  const t = input.trim();
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  if (!countryIndex) {
    countryIndex = new Map();
    // A..Z x A..Z is only 676 lookups, done once.
    for (let a = 65; a <= 90; a++) {
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a, b);
        try {
          const name = REGION_NAMES.of(code);
          if (name && name !== code) countryIndex.set(slugify(name), code);
        } catch {
          /* skip */
        }
      }
    }
  }
  return countryIndex.get(slugify(t));
}

/** Parse "1,900 students" style numbers. */
export function parseCount(s: string): number | undefined {
  const cleaned = s.replace(/[, ]/g, "");
  const n = Number.parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : undefined;
}

export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 1)).trimEnd() + "…";
}

export function uniq<T>(xs: Iterable<T>): T[] {
  return [...new Set(xs)];
}

export function toIso(v: unknown): string | undefined {
  if (v == null) return undefined;
  const d = typeof v === "number" ? new Date(v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
