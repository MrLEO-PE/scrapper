/**
 * Working out a school's website when nobody publishes it.
 *
 * This is the bottleneck behind almost every empty column. The crawl finds the
 * careers email, the package, the head's name and the PE facts, and it cannot
 * start without an address — yet Teach Away leaves the website blank for about
 * seven schools in ten.
 *
 * Two routes, and neither is a guess:
 *
 *   1. The domain of an address the school itself published. A school writing
 *      from `careers@ucsischools.edu.my` has told us its website.
 *   2. A web search (when SCRAPPER_SEARCH_KEY is set).
 *
 * Both are checked against the page that answers before being accepted. A
 * site belonging to a different school is worse than none: it produces a
 * confident careers email, package and pay figure for the wrong place.
 *
 * Guessing domains from the name (yis.edu.mm from "Yangon International
 * School") was removed on purpose — no website is ever invented here.
 */

import { fetchText } from "../core/http.ts";
import { log } from "../core/logger.ts";

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
  /** How it was established: the domain of an address we hold, or a search. */
  via: "email" | "search";
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
  let tried = 0;

  const check = async (url: string, via: SiteFound["via"]): Promise<SiteFound | null> => {
    tried++;
    const html = await fetchText(url, { soft: true, retries: 0, timeoutMs: 8000, label: `site ${via} ${url}` });
    if (!html || !pageIsSchool(html, name)) return null;
    log.debug(`${name}: ${url} verified by ${via}`);
    return { url, via, tried };
  };

  // An email domain is strong evidence, but a shared or parent-company domain
  // is not this school's site — so it is checked like anything else.
  const fromEmail = siteFromEmail(knownEmail);
  if (fromEmail) {
    const hit = await check(fromEmail, "email");
    if (hit) return hit;
  }

  // A search engine's first result is a strong hint, not proof.
  for (const url of await searchForSite(name, country)) {
    const hit = await check(url, "search");
    if (hit) return hit;
  }

  return null;
}
