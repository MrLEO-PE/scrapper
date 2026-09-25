/**
 * Working out a school's website when nobody publishes it.
 *
 * This is the bottleneck behind almost every empty column. The crawl finds the
 * careers email, the package, the head's name and the PE facts, and it cannot
 * start without an address — yet Teach Away leaves the website blank for about
 * seven schools in ten.
 *
 * Two routes, cheapest first:
 *
 *   1. The domain of an address we already hold. A school writing from
 *      `careers@ucsischools.edu.my` has told us its website.
 *   2. A guess from the name, checked against the site that answers.
 *
 * Guessing is only safe because of the check. An address belonging to a
 * different school is worse than none at all: it produces a confident careers
 * email, package and pay figure for the wrong place, and nothing downstream
 * looks any less certain than the truth. So a candidate is accepted only when
 * the page that answers is recognisably this school's.
 */

import { fetchText } from "../core/http.ts";
import { log } from "../core/logger.ts";

/**
 * Where schools in each country actually sit. Ordered by how likely they are,
 * because every extra candidate is a request against a host that may not exist.
 */
const TLDS: Record<string, string[]> = {
  Thailand: ["ac.th", "com", "co.th"],
  Malaysia: ["edu.my", "com", "com.my"],
  Vietnam: ["edu.vn", "com", "com.vn"],
  China: ["cn", "com", "com.cn", "edu.cn"],
  Singapore: ["edu.sg", "com.sg", "com"],
  Indonesia: ["sch.id", "com", "ac.id"],
  Japan: ["ed.jp", "ac.jp", "com"],
  "South Korea": ["kr", "com", "or.kr"],
  Taiwan: ["edu.tw", "com.tw", "org.tw"],
  India: ["edu.in", "com", "in"],
  Philippines: ["edu.ph", "com", "org"],
  Cambodia: ["edu.kh", "com"],
  Myanmar: ["edu.mm", "com"],
  "Sri Lanka": ["lk", "com"],
  Nepal: ["edu.np", "com"],
  Bangladesh: ["edu.bd", "com"],
  Pakistan: ["edu.pk", "com"],
  Uzbekistan: ["uz", "com"],
  Türkiye: ["k12.tr", "com.tr", "com"],
  Tanzania: ["ac.tz", "com", "co.tz"],
  Mozambique: ["co.mz", "com"],
  Colombia: ["edu.co", "com.co", "com"],
  "Costa Rica": ["ed.cr", "cr", "com"],
  Peru: ["edu.pe", "com.pe", "com"],
  Guatemala: ["edu.gt", "com.gt", "com"],
  Nicaragua: ["edu.ni", "com.ni", "com"],
  Venezuela: ["edu.ve", "com.ve", "com"],
  Ecuador: ["edu.ec", "k12.ec", "com.ec"],
  Australia: ["edu.au", "com.au", "vic.edu.au"],
  "New Zealand": ["school.nz", "ac.nz", "co.nz"],
  "Papua New Guinea": ["ac.pg", "com.pg"],
  Laos: ["edu.la", "com"],
  Bhutan: ["edu.bt", "bt"],
  Kyrgyzstan: ["kg", "edu.kg"],
  Maldives: ["edu.mv", "mv"],
  Fiji: ["edu.fj", "com.fj"],
};

/** Words that describe every school and so identify none. */
const GENERIC = new Set([
  "the", "school", "schools", "international", "academy", "college", "private",
  "of", "and", "campus", "education", "educational", "institute", "centre",
  "center", "public", "foundation", "group", "learning", "kindergarten",
  "preschool", "primary", "secondary", "high", "elementary", "bilingual",
]);

/**
 * Nationalities and places. These read as distinctive but are not: "Canadian
 * International School of Singapore" and "Canadian Education College" share
 * both their words, and guessing `canadian.edu.sg` reaches the language school
 * rather than the school we wanted. That was a real false positive.
 */
const NOT_DISTINCTIVE = new Set([
  "american", "british", "canadian", "australian", "french", "german", "swiss",
  "japanese", "chinese", "korean", "indian", "dutch", "russian", "italian",
  "spanish", "portuguese", "singapore", "singaporean", "malaysian", "thai",
  "vietnamese", "indonesian", "filipino", "european", "asian", "western",
  "eastern", "northern", "southern", "central", "global", "world", "modern",
  "new", "national", "city", "town", "united", "saint", "st",
]);

const words = (name: string): string[] =>
  name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** The parts of a name that could actually identify one school. */
export function distinctiveWords(name: string): string[] {
  return words(name).filter((w) => w.length > 2 && !GENERIC.has(w) && !NOT_DISTINCTIVE.has(w));
}

/**
 * Hostnames worth trying for this school.
 *
 * Returns nothing when the name has no distinctive part — "Canadian
 * International School" is every second school in Asia, and a guess from it
 * would be a coin toss dressed as a finding.
 */
export function candidateHosts(name: string, country: string): string[] {
  const distinctive = distinctiveWords(name);
  if (!distinctive.length) return [];

  const all = words(name);
  const tlds = TLDS[country];
  if (!tlds) return [];

  const stems = new Set<string>();
  stems.add(distinctive.join(""));
  if (distinctive.length > 1) stems.add(distinctive.slice(0, 2).join(""));
  stems.add(distinctive[0]!);
  // The classic international-school acronym, from every word including the
  // generic ones: Yangon International School is yis.edu.mm.
  if (all.length >= 2 && all.length <= 6) stems.add(all.map((w) => w[0]).join(""));

  const out: string[] = [];
  for (const stem of stems) {
    if (stem.length < 3 || stem.length > 30) continue;
    for (const tld of tlds) out.push(`${stem}.${tld}`);
  }
  return out.slice(0, 10);
}

/**
 * Is the page that answered actually this school's?
 *
 * Requires the site to look like a school at all, and most of the name's
 * distinctive words to appear. The distinctive-word filter is doing the real
 * work: without it, any page mentioning "Canadian" and "Singapore" passes.
 */
export function pageIsSchool(html: string, name: string): boolean {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .toLowerCase();

  const distinctive = distinctiveWords(name);
  if (!distinctive.length) return false;

  const hits = distinctive.filter((w) => text.includes(w)).length;
  if (hits / distinctive.length < 0.6) return false;

  /*
   * One word repeated is not a school; a school says many of them, often.
   *
   * basis.com answered for "BASIS Global" and is an advertising automation
   * platform. It uses one schoolish word six times — its product is called
   * Basis Academy — while Fairview International School's site uses eight
   * different ones forty-five times. Variety is what separates them, and it
   * does so without a title check, which wrongly rejected real schools whose
   * homepage is titled "Malaysia's Best Rated International School".
   */
  const SCHOOLISH = /\b(?:school|academy|college|students?|pupils?|curriculum|admissions?|campus|teachers?|classrooms?|enrol)\b/g;
  const found = [...text.matchAll(SCHOOLISH)].map((m) => m[0]);
  if (found.length < 4 || new Set(found).size < 2) return false;

  return true;
}

/** Free mailbox providers, whose domain says nothing about the school. */
const FREE_MAILBOX =
  /^(?:gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|aol|icloud|me|mail|gmx|protonmail|proton|qq|163|126|sina|sohu|foxmail|naver|daum|yandex|rediffmail)\./i;

/** The website implied by an address we already hold, if any. */
export function siteFromEmail(email: string | null | undefined): string | null {
  const domain = email?.split("@")[1]?.trim().toLowerCase();
  if (!domain || FREE_MAILBOX.test(domain + ".")) return null;
  // A careers address on a group's ATS domain is not the school's website.
  if (/^(?:jobs|careers|recruit|apply|hire|talent|workday|myworkday)\./i.test(domain)) return null;
  return "https://" + domain;
}

export interface SiteFound {
  url: string;
  /** How it was established: an address we hold, a guess, or a search. */
  via: "email" | "guess" | "search";
  /** How many hosts were tried to get here. */
  tried: number;
}

/**
 * Hosts a search will return for a school that are not the school: job boards,
 * directories, social platforms, encyclopaedias. Taking any of these as the
 * website would send the crawl to read Teach Away about Teach Away.
 */
const NOT_THE_SCHOOL =
  /(?:^|\.)(?:teachaway|tes|teacherhorizons|seekteachers|edvectus|schrole|searchassociates|tieonline|linkedin|facebook|instagram|twitter|x|tiktok|youtube|wikipedia|wikimedia|glassdoor|indeed|ziprecruiter|simplify|crunchbase|bloomberg|tripadvisor|yelp|google|maps|ibo|cois|whichschooladvisor|internationalschoolsdatabase|edarabia|schoolsdirectory)\.[a-z.]+$/i;

/**
 * A web search for the school's own site.
 *
 * This is the route for the schools a guess cannot reach — the ones whose name
 * gives nothing distinctive, or whose domain ignores the country convention.
 * It needs an API key, and without one it is skipped silently: the rest of
 * discovery still works, it just finds fewer.
 *
 * Brave's free tier allows 2,000 queries a month at one per second, which
 * clears a backlog of a few hundred schools comfortably. Set the key as
 * SCRAPPER_SEARCH_KEY.
 */
export function searchKey(): string | null {
  return process.env.SCRAPPER_SEARCH_KEY?.trim() || null;
}

let warnedNoKey = false;

async function searchForSite(name: string, country: string): Promise<string[]> {
  const key = searchKey();
  if (!key) {
    if (!warnedNoKey) {
      warnedNoKey = true;
      log.info("no SCRAPPER_SEARCH_KEY set — skipping web search for missing websites (see README)");
    }
    return [];
  }

  const q = `"${name}" ${country} international school official website`;
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=8`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json", "X-Subscription-Token": key },
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    log.debug(`search failed for ${name}: ${(err as Error).message}`);
    return [];
  }
  if (!res.ok) {
    log.warn(`search returned ${res.status} for ${name}${res.status === 429 ? " — rate limited" : ""}`);
    return [];
  }

  const body = (await res.json()) as { web?: { results?: { url?: string }[] } };
  const out: string[] = [];
  for (const r of body.web?.results ?? []) {
    const host = hostOfUrl(r.url);
    if (!host || NOT_THE_SCHOOL.test(host)) continue;
    if (out.some((u) => hostOfUrl(u) === host)) continue;
    out.push(`https://${host}`);
  }
  // The free tier allows one query a second; stay under it.
  await new Promise((r) => setTimeout(r, 1100));
  return out.slice(0, 4);
}

function hostOfUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Find and verify one school's website. Returns nothing rather than a guess.
 */
export async function findWebsite(
  name: string,
  country: string,
  knownEmail?: string | null,
): Promise<SiteFound | null> {
  const fromEmail = siteFromEmail(knownEmail);
  if (fromEmail) return { url: fromEmail, via: "email", tried: 0 };

  let tried = 0;

  const check = async (url: string, via: "guess" | "search"): Promise<SiteFound | null> => {
    tried++;
    // Dead domains are the common case, so fail fast and do not retry.
    const html = await fetchText(url, { soft: true, retries: 0, timeoutMs: 8000, label: `site ${via} ${url}` });
    if (!html || !pageIsSchool(html, name)) return null;
    log.debug(`${name}: ${url} verified by ${via}`);
    return { url, via, tried };
  };

  // Guessing is free, so it goes first; search costs a quota query.
  for (const host of candidateHosts(name, country)) {
    const hit = await check("https://" + host, "guess");
    if (hit) return hit;
  }

  /*
   * Whatever the name could not reach. Every result is put through the same
   * verification as a guess — a search engine's first result is a strong hint,
   * not proof, and the cost of being wrong is unchanged.
   */
  for (const url of await searchForSite(name, country)) {
    const hit = await check(url, "search");
    if (hit) return hit;
  }

  return null;
}
