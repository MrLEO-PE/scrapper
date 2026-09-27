/**
 * A second schools database, organised by country.
 *
 * The International Schools Database is city-based and simply has no pages for
 * New Delhi, Mumbai, Bangalore, Colombo, Kathmandu, Dhaka, Sydney or Auckland
 * — so India, Sri Lanka, Nepal, Bangladesh, Australia and New Zealand were
 * invisible to it however many cities were read. This one is organised by
 * country and covers them.
 *
 * Two databases disagreeing is not a problem: a school appearing in both is
 * merged by the identity rules, and a school appearing in only one is exactly
 * why both are read. The requirement is that no good school is missing, and
 * one source can never satisfy it.
 *
 * Its robots.txt is unusually explicit — "AI crawlers and answer-time fetchers
 * are explicitly welcome. The whole site may be crawled" — so this is a
 * sanctioned read rather than a tolerated one.
 *
 * Shape: a country page carries an ItemList of schools with names and links;
 * each school page carries the official website as the first `sameAs`, plus
 * the social pages and the address.
 */

import { fetchText } from "./core/http.ts";
import { log } from "./core/logger.ts";
import { htmlToText } from "./core/text.ts";
import { extractCurriculum } from "./enrich/facts.ts";

const ORIGIN = "https://www.doris.school";

export interface DorisSchool {
  name: string;
  country: string;
  city?: string;
  website?: string;
  social: string[];
  description?: string;
  /** Addresses published as contact points — usually admissions. */
  emails: string[];
  /** Yearly tuition, picked out of the itemised offers. */
  feeLow?: number;
  feeHigh?: number;
  feeCurrency?: string;
  /** Curricula named in the school's own description of what it teaches. */
  curriculum: string[];
  sourceUrl: string;
}

/**
 * Yearly tuition, from a list that mixes it with one-off charges.
 *
 * `makesOffer` itemises everything a school bills for — application fees,
 * enrolment fees, tuition — and an application fee is not what a teacher's
 * pay tracks. Only the yearly ones count, and where several are listed (a
 * range across year groups) the span is what matters.
 */
export function yearlyFees(offers: unknown): { low?: number; high?: number; currency?: string } {
  if (!Array.isArray(offers)) return {};
  const yearly = offers.filter((o) => {
    const x = o as { name?: string; description?: string; price?: unknown };
    if (typeof x.price !== "number" || x.price <= 0) return false;
    const label = `${x.name ?? ""} ${x.description ?? ""}`.toLowerCase();
    if (/one-?time|application|enrol|enroll|registration|deposit|capital/.test(label)) return false;
    return /year|annual|tuition|term|semester/.test(label);
  }) as { price: number; priceCurrency?: string }[];

  if (!yearly.length) return {};
  const prices = yearly.map((o) => o.price);
  return {
    low: Math.min(...prices),
    high: Math.max(...prices),
    currency: yearly[0]!.priceCurrency,
  };
}

function jsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      out.push(JSON.parse(m[1]!));
    } catch {
      /* one bad block should not cost the page */
    }
  }
  return out;
}

const isSchool = (n: { "@type"?: unknown }): boolean =>
  /School|EducationalOrganization/i.test([n["@type"]].flat().join(","));

/** The schools a country page lists: name and the page describing each. */
export function parseCountry(html: string): { name: string; url: string }[] {
  for (const block of jsonLd(html)) {
    const b = block as { "@type"?: string; itemListElement?: { item?: { name?: string; url?: string } }[] };
    if (b["@type"] !== "ItemList") continue;
    return (b.itemListElement ?? [])
      .map((li) => ({ name: li.item?.name?.trim() ?? "", url: li.item?.url ?? "" }))
      .filter((s) => s.name && s.url);
  }
  return [];
}

/**
 * The school's own website, from a school page.
 *
 * `url` on these records points back at the database, so the official site is
 * the first `sameAs` that is not a social platform.
 */
export function parseSchool(html: string, fallbackName: string, sourceUrl: string): DorisSchool | null {
  for (const block of jsonLd(html)) {
    const arr = Array.isArray(block) ? block : ((block as { "@graph"?: unknown[] })["@graph"] ?? [block]);
    for (const raw of arr as Record<string, unknown>[]) {
      if (!isSchool(raw)) continue;

      const sameAs = ((raw.sameAs as string[]) ?? []).filter((s) => typeof s === "string");
      const social = sameAs.filter((s) => /facebook|instagram|linkedin|twitter|x\.com|youtube/i.test(s));
      const website = sameAs.find((s) => !social.includes(s));
      const address = raw.address as { addressLocality?: string; addressCountry?: string } | undefined;

      // Contact points carry an address far more often than the page text
      // does — usually admissions, which is a real desk and a real person.
      const emails = (Array.isArray(raw.contactPoint) ? raw.contactPoint : [])
        .map((c) => (c as { email?: string }).email)
        .filter((e): e is string => typeof e === "string" && e.includes("@"));

      // `teaches` is prose about the curriculum, which is where the named
      // programmes are — IB, Cambridge, Edexcel — rather than in a tidy list.
      const teaches = typeof raw.teaches === "string" ? raw.teaches : "";
      const curriculum = extractCurriculum(`${teaches} ${raw.description ?? ""}`)?.value ?? [];

      const fees = yearlyFees(raw.makesOffer);

      return {
        name: (raw.name as string)?.trim() || fallbackName,
        country: address?.addressCountry?.trim() ?? "",
        city: address?.addressLocality?.trim(),
        website,
        social,
        emails: [...new Set(emails)],
        curriculum,
        feeLow: fees.low,
        feeHigh: fees.high,
        feeCurrency: fees.currency,
        description: raw.description ? htmlToText(String(raw.description)).slice(0, 1200) : undefined,
        sourceUrl,
      };
    }
  }
  return null;
}

/** Country slug as this database spells it: "Sri Lanka" -> "sri-lanka". */
export const countrySlug = (country: string): string =>
  country
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export async function fetchCountry(country: string, fresh = false): Promise<DorisSchool[]> {
  const slug = countrySlug(country);
  const listUrl = `${ORIGIN}/international-schools/${slug}`;
  const html = await fetchText(listUrl, { soft: true, fresh, retries: 1, timeoutMs: 30000, label: `doris ${slug}` });
  if (!html) {
    log.debug(`doris: no page for ${country}`);
    return [];
  }

  const listed = parseCountry(html);
  if (!listed.length) {
    log.debug(`doris: ${country} listed no schools`);
    return [];
  }

  const out: DorisSchool[] = [];
  for (const entry of listed) {
    const page = await fetchText(entry.url, { soft: true, fresh, retries: 0, timeoutMs: 25000, label: `doris school` });
    if (!page) continue;
    const school = parseSchool(page, entry.name, entry.url);
    if (!school) continue;
    // The listing is per country, so trust that over a missing address field.
    if (!school.country) school.country = country;
    out.push(school);
  }

  const withSite = out.filter((s) => s.website).length;
  log.info(`doris: ${country} — ${out.length} schools, ${withSite} with a website`);
  return out;
}
