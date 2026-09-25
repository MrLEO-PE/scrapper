/**
 * A school's social presence — recorded as somewhere for *you* to look, never
 * read by the scraper.
 *
 * Plenty of schools, especially smaller ones, have no website at all but do run
 * a Facebook or Instagram page. That page usually carries the head's name, the
 * sports facilities and often a contact address — exactly the details the
 * Prepared Email needs and the crawl cannot otherwise reach.
 *
 * The scraper must not fetch those pages. Meta's Automated Data Collection
 * Terms prohibit automated collection from Facebook and Instagram without
 * express written permission, and LinkedIn's terms say the same. A person
 * opening a public page in a browser is an entirely different thing, and that
 * is the point of this module: capture the link, put it in the sheet, and let
 * you do the looking.
 *
 * `NEVER_FETCH` is therefore load-bearing, not advisory. A social URL can be
 * stored in the same fields a website would occupy, so the crawler has to
 * refuse it by host rather than by trusting where it came from.
 */

/** Hosts whose terms forbid automated collection. Never fetched, only linked. */
const NEVER_FETCH =
  /(?:^|\.)(?:facebook\.com|fb\.com|fb\.me|messenger\.com|instagram\.com|threads\.net|linkedin\.com|lnkd\.in|x\.com|twitter\.com|tiktok\.com|weibo\.com|xiaohongshu\.com)$/i;

export function isNeverFetch(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url.startsWith("http") ? url : "https://" + url).hostname.replace(/^www\./, "");
    return NEVER_FETCH.test(host);
  } catch {
    return false;
  }
}

export type SocialKind = "facebook" | "instagram" | "linkedin" | "other";

export interface SocialLink {
  url: string;
  kind: SocialKind;
}

const PATTERNS: { re: RegExp; kind: SocialKind }[] = [
  { re: /^(?:www\.)?(?:facebook\.com|fb\.com|fb\.me)$/i, kind: "facebook" },
  { re: /^(?:www\.)?instagram\.com$/i, kind: "instagram" },
  { re: /^(?:[a-z]{2,3}\.)?linkedin\.com$/i, kind: "linkedin" },
];

/**
 * Paths that are the platform's own furniture rather than a school's page —
 * share widgets, login walls, the platform's own accounts.
 */
const NOT_A_PAGE =
  /^\/(?:$|sharer|share|dialog|login|signup|help|about|privacy|policies|legal|tr\?|plugins|hashtag|explore|accounts|p\/|reel|reels|story|stories|watch|events\/?$|profile\.php\?id=$)/i;

const SOCIAL_URL = /https?:\/\/[A-Za-z0-9.-]+\/[^\s"'<>)\]}]*/g;

/**
 * Pull school social pages out of a blob of text.
 *
 * Conservative: a share button links to facebook.com/sharer, and a footer
 * links to the platform's own page as often as the school's. Only paths that
 * look like an account are kept.
 */
export function extractSocial(text: string): SocialLink[] {
  if (!text) return [];
  const out = new Map<string, SocialLink>();

  for (const match of text.matchAll(SOCIAL_URL)) {
    let url: URL;
    try {
      url = new URL(match[0]);
    } catch {
      continue;
    }
    const host = url.hostname;
    const hit = PATTERNS.find((p) => p.re.test(host));
    if (!hit) continue;
    if (NOT_A_PAGE.test(url.pathname)) continue;

    // An account path is one or two segments: /theschool or /school/theschool.
    const parts = url.pathname.split("/").filter(Boolean);
    if (!parts.length || parts.length > 2) continue;
    if (parts[0]!.length < 3) continue;

    // Query strings on these are tracking, not identity.
    const clean = `https://${host.replace(/^www\./, "")}/${parts.join("/")}`;
    if (!out.has(clean)) out.set(clean, { url: clean, kind: hit.kind });
  }
  return [...out.values()];
}

/**
 * The one to show. Facebook first: school pages there carry the most usable
 * detail — an About section with the head's name and a contact address —
 * whereas Instagram is mostly photographs and LinkedIn is mostly staff.
 */
export function bestSocial(links: SocialLink[]): SocialLink | undefined {
  const order: SocialKind[] = ["facebook", "instagram", "linkedin", "other"];
  for (const kind of order) {
    const hit = links.find((l) => l.kind === kind);
    if (hit) return hit;
  }
  return undefined;
}
