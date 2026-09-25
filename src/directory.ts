/**
 * Directory mode — schools first, vacancies second.
 *
 * Builds a per-country list of international schools whether or not they are
 * advertising a PE role right now, then enriches each one into the same sheet
 * columns as the job-driven flow. This is the long-term view: who is out there,
 * how big they are, what they teach, and who to write to.
 *
 * Source: Teach Away's school directory. Its per-country pages embed the full
 * school record (website, accreditation, type, location) in the page's React
 * Flight payload, so one request per country yields the whole list.
 *
 * On "top 30": there is no official global ranking of international schools, so
 * ranking here is an explicit, inspectable prominence score built from
 * directory metadata (accreditation body, recognition, hiring activity, profile
 * completeness). It is a shortlist heuristic, not a league table.
 */

import { fetchText } from "./core/http.ts";
import { log } from "./core/logger.ts";
import { htmlToText, schoolKey, slugify } from "./core/text.ts";
import type { SchoolPhase } from "./core/types.ts";

const ORIGIN = "https://www.teachaway.com";

export interface DirectorySchool {
  schoolKey: string;
  name: string;
  slug: string;
  country: string;
  countryCode?: string;
  city?: string;
  website?: string;
  orgType?: string;
  ownership?: string;
  accredited: boolean;
  accredBodies: string[];
  recognised: boolean;
  description?: string;
  emails: string[];
  /** Published by the directory. The only route left when no email exists. */
  phone?: string;
  jobCount: number;
  prominence: number;
  /** Human-readable reasons behind the score, shown in the report. */
  why: string[];
  directoryUrl: string;
}

/**
 * Accreditation bodies that carry real weight in international schooling.
 *
 * These dominate the score because they are the closest thing to an objective
 * signal of a school worth teaching at: independent inspection, and standards
 * the school has to keep meeting.
 */
const STRONG_BODIES: { re: RegExp; label: string; points: number }[] = [
  { re: /\bCIS\b|Council of International Schools/i, label: "CIS", points: 16 },
  { re: /\bIBO?\b|International Baccalaureate/i, label: "IB", points: 16 },
  { re: /\bNEASC\b|New England Association/i, label: "NEASC", points: 14 },
  { re: /\bWASC\b|Western Association/i, label: "WASC", points: 14 },
  { re: /\bMSA\b|Middle States/i, label: "MSA", points: 13 },
  { re: /\bCOBIS\b/i, label: "COBIS", points: 13 },
  { re: /\bBSO\b|British Schools Overseas/i, label: "BSO", points: 12 },
  { re: /\bAdvancED\b|\bCognia\b/i, label: "Cognia", points: 10 },
  { re: /\bNABSS\b|\bECIS\b|\bAISA\b|\bEARCOS\b|\bNESA\b/i, label: "regional association", points: 8 },
];

function endOfValue(s: string, start: number): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      if (--depth === 0) return i + 1;
    }
  }
  return -1;
}

function readFlight(html: string): string {
  const marker = "self.__next_f.push([1,";
  let out = "";
  let i = 0;
  while ((i = html.indexOf(marker, i)) !== -1) {
    const start = i + marker.length;
    if (html[start] !== '"') {
      i = start;
      continue;
    }
    let j = start + 1;
    while (j < html.length) {
      if (html[j] === "\\") {
        j += 2;
        continue;
      }
      if (html[j] === '"') break;
      j++;
    }
    try {
      out += JSON.parse(html.slice(start, j + 1)) as string;
    } catch {
      /* skip */
    }
    i = j + 1;
  }
  return out;
}

interface RawSchool {
  id?: number;
  schoolName?: string;
  slug?: string;
  jobs?: unknown[];
  schoolProfiles?: {
    website?: string;
    orgType?: string;
    type?: string;
    country?: string;
    locality?: string;
    description?: string;
    intAccreditations?: string;
    accredBodies?: string;
    recognizedInstitution?: boolean;
    notifJobEmail?: string[];
    notifEmailAddresses?: string[];
    phoneNumber?: string;
    slideshow?: unknown[];
    videos?: unknown[];
    brochures?: unknown[];
  }[];
}

/** Pull every school record out of a directory page. */
function extractSchools(flight: string): RawSchool[] {
  const found = new Map<number | string, RawSchool>();
  const NEEDLE = '"schoolProfiles"';
  let i = 0;

  while ((i = flight.indexOf(NEEDLE, i)) !== -1) {
    let parsed: RawSchool | null = null;
    let end = -1;

    for (let k = i; k >= 0 && i - k < 200_000; k--) {
      if (flight[k] !== "{") continue;
      const stop = endOfValue(flight, k);
      if (stop <= i) continue;
      try {
        parsed = JSON.parse(flight.slice(k, stop)) as RawSchool;
        end = stop;
      } catch {
        continue;
      }
      break;
    }

    if (parsed?.schoolName && parsed.slug) {
      const key = parsed.id ?? parsed.slug;
      if (!found.has(key)) found.set(key, parsed);
      i = end > i ? end : i + NEEDLE.length;
    } else {
      i += NEEDLE.length;
    }
  }
  return [...found.values()];
}

/**
 * Prominence score. Deliberately simple and explainable: every point is
 * attributable to a stated reason, which the report shows alongside the rank.
 */
function scoreSchool(s: RawSchool, profile: NonNullable<RawSchool["schoolProfiles"]>[number]): { score: number; why: string[]; bodies: string[] } {
  let score = 0;
  const why: string[] = [];
  const bodies: string[] = [];

  const accredText = `${profile.accredBodies ?? ""} ${profile.description ?? ""}`;
  if (/^accredited$/i.test(profile.intAccreditations ?? "")) {
    score += 12;
    why.push("internationally accredited");
  }
  for (const body of STRONG_BODIES) {
    if (body.re.test(accredText)) {
      score += body.points;
      bodies.push(body.label);
    }
  }
  if (bodies.length) why.push(`accredited by ${bodies.join(", ")}`);

  if (profile.recognizedInstitution) {
    score += 10;
    why.push("recognised institution");
  }

  /*
   * Hiring activity is deliberately NOT scored.
   *
   * This list answers "which schools are worth teaching at", not "who is
   * advertising today" — a school belongs in its country's top regardless of
   * whether it has a vacancy this week. Scoring it also pointed the wrong way:
   * a school posting thirteen roles at once may be a school people keep
   * leaving. The count is still recorded, and the Turnover column reads it
   * over time, where repetition actually means something.
   */

  // An all-through school gives a PE teacher the widest scope.
  if (/K12|K_12/i.test(profile.orgType ?? "")) {
    score += 6;
    why.push("all-through school");
  }

  // Transparency, not marketing: these are weak signals and weighted as such.
  if (profile.website) score += 3;

  const descLength = (profile.description ?? "").length;
  if (descLength > 1200) score += 2;

  const media = (profile.slideshow?.length ?? 0) + (profile.videos?.length ?? 0) + (profile.brochures?.length ?? 0);
  if (media > 0) score += Math.min(2, media);

  return { score, why, bodies };
}

export function phaseFromOrgType(orgType?: string): SchoolPhase | undefined {
  if (!orgType) return undefined;
  if (/K12|K_12/i.test(orgType)) return "k12";
  if (/university|college|higher/i.test(orgType)) return "university";
  if (/kindergarten|preschool|early/i.test(orgType)) return "primary";
  if (/secondary|high/i.test(orgType)) return "secondary";
  return undefined;
}

export interface FetchDirectoryOptions {
  fresh?: boolean;
  /** Keep only the top N by prominence. 0 = keep all. */
  top?: number;
  /** Restrict to these cities (loose match). */
  cities?: string[];
  /**
   * Override the URL slug. The directory does not always use the name we do:
   * it files Türkiye under "turkey" and Micronesia under its full formal name.
   */
  slug?: string;
}

/**
 * Fetch the school directory for one country.
 * `countrySlug` is the Teach Away slug, e.g. "united-arab-emirates".
 */
export async function fetchCountryDirectory(
  countryName: string,
  opts: FetchDirectoryOptions = {},
): Promise<DirectorySchool[]> {
  const slug = opts.slug ?? slugify(countryName);
  const url = `${ORIGIN}/schools/country/${slug}`;

  const html = await fetchText(url, {
    fresh: opts.fresh,
    soft: true,
    retries: 1,
    timeoutMs: 30000,
    label: `directory ${countryName}`,
  });
  if (!html) {
    log.warn(`directory: no page for ${countryName} (${url})`);
    return [];
  }

  const raw = extractSchools(readFlight(html));
  if (!raw.length) {
    log.warn(`directory: ${countryName} page had no school records`);
    return [];
  }

  const out: DirectorySchool[] = [];
  for (const s of raw) {
    const profile = s.schoolProfiles?.[0];
    if (!profile) continue;

    const city = profile.locality?.trim();
    if (opts.cities?.length) {
      const hay = `${city ?? ""}`.toLowerCase();
      if (!opts.cities.some((c) => hay.includes(c.toLowerCase()))) continue;
    }

    const { score, why, bodies } = scoreSchool(s, profile);
    const emails = [...new Set([...(profile.notifJobEmail ?? []), ...(profile.notifEmailAddresses ?? [])])]
      .filter((e) => typeof e === "string" && e.includes("@"));

    out.push({
      schoolKey: schoolKey(s.schoolName!, countryName),
      name: s.schoolName!,
      slug: s.slug!,
      country: countryName,
      countryCode: profile.country,
      city,
      website: profile.website,
      orgType: profile.orgType,
      ownership: profile.type,
      accredited: /^accredited$/i.test(profile.intAccreditations ?? ""),
      accredBodies: bodies,
      recognised: !!profile.recognizedInstitution,
      description: profile.description ? htmlToText(profile.description).slice(0, 2000) : undefined,
      emails,
      phone: profile.phoneNumber?.trim() || undefined,
      jobCount: s.jobs?.length ?? 0,
      prominence: score,
      why,
      directoryUrl: `${ORIGIN}/schools/${s.slug}`,
    });
  }

  out.sort((a, b) => b.prominence - a.prominence || a.name.localeCompare(b.name));
  const limited = opts.top && opts.top > 0 ? out.slice(0, opts.top) : out;

  log.info(
    `directory: ${countryName} — ${out.length} schools found, keeping ${limited.length}` +
      (opts.cities?.length ? ` (cities: ${opts.cities.join(", ")})` : ""),
  );
  return limited;
}
