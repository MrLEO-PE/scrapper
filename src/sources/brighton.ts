/**
 * Brighton College International, careers.brightoncollegeinternational.com.
 *
 * Each school has a page on the group's careers site listing its vacancies as
 * plain HTML cards: title, "BANGKOK, THAILAND", "Closes: 30/11/2026" and a
 * one-line teaser. robots.txt disallows nothing. (An earlier check failed on
 * a one-off network error, which made it look unreadable.)
 *
 * Only the Asian schools are read; the UK, European and Gulf ones are outside
 * the countries this search covers. School names are the site's own labels.
 */

import { fetchText } from "../core/http.ts";
import { htmlToText } from "../core/text.ts";
import type { RawJob } from "../core/types.ts";
import type { ScrapeContext, Source } from "./base.ts";

const ORIGIN = "https://careers.brightoncollegeinternational.com";

const SCHOOLS: { slug: string; name: string }[] = [
  { slug: "brighton-college-bangkok", name: "Brighton College Bangkok" },
  { slug: "brighton-college-bangkok-vibhavadi", name: "Brighton College Bangkok Vibhavadi" },
  { slug: "brighton-college-singapore", name: "Brighton College Singapore" },
  { slug: "brighton-college-vietnam", name: "Brighton College Vietnam" },
  { slug: "kansai-gaidai", name: "Brighton College Kansai Gaidai" },
];

export interface Card {
  slug: string;
  title: string;
  location?: string;
  closes?: string;
  teaser?: string;
}

export function cardsFrom(html: string): Card[] {
  const out: Card[] = [];
  const re = /<h3[^>]*>\s*<a href="\/job-vacancies\/([^"]+)">([\s\S]*?)<\/a>\s*<\/h3>([\s\S]*?)class="button--sea"/g;
  for (const m of html.matchAll(re)) {
    const body = m[3]!.replace(/<svg[\s\S]*?<\/svg>/g, "");
    out.push({
      slug: m[1]!,
      title: htmlToText(m[2]!).trim(),
      location: body.match(/<div class="type-lg uppercase">\s*([^<]+?)\s*<\/div>/)?.[1],
      closes: body.match(/Closes:\s*(\d{2}\/\d{2}\/\d{4})/)?.[1],
      teaser: body.match(/<div class="type-base[^"]*">\s*([\s\S]*?)\s*<\/div>/)?.[1]?.trim(),
    });
  }
  return out;
}

/** "BANGKOK, THAILAND" -> Bangkok, Thailand. */
export function placeOf(location?: string): { city?: string; country?: string } {
  const parts = (location ?? "").split(",").map((s) => s.trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())).filter(Boolean);
  return parts.length >= 2 ? { city: parts[0], country: parts.at(-1) } : { country: parts[0] };
}

export function isoDate(d?: string): string | undefined {
  const m = d?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined;
}

async function collect(ctx: ScrapeContext): Promise<RawJob[]> {
  const jobs = new Map<string, RawJob>();
  for (const s of SCHOOLS) {
    const html = await fetchText(`${ORIGIN}/schools/${s.slug}`, { soft: true, fresh: ctx.fresh, retries: 1, timeoutMs: 30000, label: `brighton ${s.slug}` });
    for (const c of html ? cardsFrom(html) : []) {
      const url = `${ORIGIN}/job-vacancies/${c.slug}`;
      jobs.set(c.slug, {
        source: "brighton",
        sourceJobId: c.slug,
        title: c.title,
        url,
        schoolName: s.name,
        ...placeOf(c.location),
        deadlineAt: isoDate(c.closes),
        description: c.teaser ? htmlToText(c.teaser) : undefined,
        applicationUrl: url,
        raw: c as unknown as Record<string, unknown>,
      });
    }
  }
  const out = [...jobs.values()];
  return ctx.maxJobs ? out.slice(0, ctx.maxJobs) : out;
}

export const brightonSource: Source = {
  id: "brighton",
  label: "Brighton College International",
  note: "group careers site, the Asian schools' vacancy pages; school and closing date named",
  collect,
};
