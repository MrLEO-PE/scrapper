/**
 * The International Schools Database — the directory the other one is missing.
 *
 * Teach Away's directory only lists schools that chose to advertise there, and
 * the established ones do not need to. A sanity check against Bangkok found
 * Patana, Regent's, Bromsgrove and Harrow absent entirely, while NIST sat at
 * #33 and Shrewsbury at #37 behind schools nobody has heard of. You cannot
 * rank a school that is not there.
 *
 * This source fixes that and two other things at once. Every city page embeds
 * schema.org JSON-LD describing every school in the city, and each record
 * carries:
 *
 *   - the school's own website, which is the bottleneck behind almost every
 *     empty column in the sheet;
 *   - yearly tuition as an AggregateOffer, which is the first per-school
 *     money signal available anywhere — country salary benchmarks are
 *     identical for every school in a country and so cannot rank them;
 *   - the social pages, age range, address and a description.
 *
 * Bangkok alone returns 103 schools, 81 of them with fees.
 *
 * On fees as a salary signal: they are not salary, and this file does not
 * pretend otherwise. What they are is the best available proxy — a school
 * charging three times its neighbour is not paying its teachers the same, and
 * fees are published where salaries are not. The sheet labels them as fees.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchText } from "./core/http.ts";
import { log } from "./core/logger.ts";
import { htmlToText } from "./core/text.ts";

const ORIGIN = "https://www.international-schools-database.com";

export interface DbSchool {
  name: string;
  city?: string;
  country?: string;
  website?: string;
  description?: string;
  /** Yearly tuition, as the database publishes it. */
  feeLow?: number;
  feeHigh?: number;
  feeCurrency?: string;
  /** "3-18" — the age range the school serves. */
  ageRange?: string;
  /** Facebook, LinkedIn and the like. Recorded, never fetched. */
  social: string[];
  sourceUrl: string;
}

interface LdNode {
  "@type"?: string | string[];
  name?: string;
  url?: string;
  description?: string;
  typicalAgeRange?: string;
  sameAs?: string[];
  address?: { addressLocality?: string; addressCountry?: string; addressRegion?: string };
  offers?: { priceCurrency?: string; lowPrice?: number; highPrice?: number };
}

/** Every JSON-LD block on a page, parsed and forgiving of the broken ones. */
function jsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      out.push(JSON.parse(m[1]!));
    } catch {
      /* a malformed block should not lose the rest of the page */
    }
  }
  return out;
}

const isSchool = (n: LdNode): boolean =>
  /School|EducationalOrganization/i.test([n["@type"]].flat().join(","));

/**
 * The country a city page belongs to.
 *
 * The site is organised by city, and its country pages show the same global
 * navigation regardless of country — so the only reliable answer is the
 * breadcrumb, which reads Home > Thailand > Bangkok.
 */
export function countryOf(html: string): string | undefined {
  for (const block of jsonLd(html)) {
    const b = block as { "@type"?: string; itemListElement?: { item?: { name?: string } ; name?: string }[] };
    if (b["@type"] !== "BreadcrumbList") continue;
    const items = b.itemListElement ?? [];
    // Home, Country, City — the country is the second of three.
    if (items.length >= 3) return (items[1]?.item?.name ?? items[1]?.name)?.trim();
  }
  return undefined;
}

/** Every city the database covers, from the navigation on any city page. */
export function citiesIn(html: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(/href="(?:https:\/\/www\.international-schools-database\.com)?\/in\/([a-z0-9-]+)"/gi)) {
    found.add(m[1]!);
  }
  return [...found];
}

export function parseCity(html: string, sourceUrl: string): DbSchool[] {
  const country = countryOf(html);
  const out: DbSchool[] = [];

  for (const block of jsonLd(html)) {
    const graph = (block as { "@graph"?: LdNode[] })["@graph"];
    if (!graph) continue;

    for (const n of graph) {
      if (!isSchool(n) || !n.name) continue;
      const fees = n.offers;
      out.push({
        name: n.name.trim(),
        city: n.address?.addressLocality?.trim(),
        country: country ?? n.address?.addressCountry?.trim(),
        website: n.url?.trim() || undefined,
        description: n.description ? htmlToText(n.description).slice(0, 1200) : undefined,
        feeLow: typeof fees?.lowPrice === "number" ? fees.lowPrice : undefined,
        feeHigh: typeof fees?.highPrice === "number" ? fees.highPrice : undefined,
        feeCurrency: fees?.priceCurrency?.trim() || undefined,
        ageRange: n.typicalAgeRange?.trim() || undefined,
        social: (n.sameAs ?? []).filter((s) => typeof s === "string"),
        sourceUrl,
      });
    }
  }
  return out;
}

export async function fetchCity(city: string, fresh = false): Promise<DbSchool[]> {
  const url = `${ORIGIN}/in/${city}`;
  const html = await fetchText(url, { soft: true, fresh, retries: 1, timeoutMs: 30000, label: `schoolsdb ${city}` });
  if (!html) {
    log.warn(`schoolsdb: no page for ${city}`);
    return [];
  }
  const schools = parseCity(html, url);
  if (schools.length) {
    const withFees = schools.filter((s) => s.feeLow != null).length;
    const withSite = schools.filter((s) => s.website).length;
    log.info(`schoolsdb: ${city} — ${schools.length} schools, ${withSite} with a website, ${withFees} with fees`);
  }
  return schools;
}

/**
 * Every city the database covers, from its sitemap.
 *
 * Not from a city page's navigation, which is what this used to do: that nav
 * is regional, so reading it from Bangkok returned 146 cities and silently
 * omitted Singapore — 71 schools — along with Hong Kong, Da Nang, Busan and
 * 196 others. The sitemap lists 345. For a list whose whole purpose is not to
 * miss a good school, deriving coverage from a page's own links was the wrong
 * instinct.
 */
export async function allCities(fresh = false): Promise<string[]> {
  const xml = await fetchText(`${ORIGIN}/sitemap.xml`, {
    soft: true,
    fresh,
    retries: 1,
    timeoutMs: 45000,
    label: "schoolsdb sitemap",
  });
  if (xml) {
    const found = new Set<string>();
    for (const m of xml.matchAll(/<loc>https:\/\/www\.international-schools-database\.com\/in\/([a-z0-9-]+)<\/loc>/g)) {
      found.add(m[1]!);
    }
    if (found.size) return [...found];
    log.warn("schoolsdb: sitemap had no city pages — falling back to page navigation");
  }

  // Only if the sitemap is unreachable. Incomplete, but better than nothing.
  const html = await fetchText(`${ORIGIN}/in/bangkok`, { soft: true, fresh, retries: 1, timeoutMs: 30000, label: "schoolsdb cities" });
  return html ? citiesIn(html) : [];
}

/**
 * The cities to read for the configured countries.
 *
 * The map is recorded rather than derived each run: the site's country pages
 * show the same global navigation whatever country you ask for, so the only
 * reliable source is each city page's own breadcrumb, and re-reading 146 of
 * them every night to learn what has not changed would be wasteful.
 */
export function citiesFor(inCountry: (country: string) => boolean): { city: string; country: string }[] {
  const path = join(process.cwd(), "config", "schoolsdb-cities.json");
  if (!existsSync(path)) {
    log.warn(`schoolsdb: ${path} is missing — run the city mapping first`);
    return [];
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { cities?: Record<string, string> };
    return Object.entries(parsed.cities ?? {})
      .filter(([, country]) => inCountry(country))
      .map(([city, country]) => ({ city, country }));
  } catch (err) {
    log.warn(`schoolsdb: could not read the city map: ${(err as Error).message}`);
    return [];
  }
}
