/**
 * SeekTeachers (seekteachers.com).
 *
 * Added because TES was 64% of every vacancy in the database. One board
 * carrying two thirds of the feed is a single point of failure: a layout
 * change there and most of the pipeline goes quiet.
 *
 * This one is an old-fashioned server-rendered ASP site, which is exactly what
 * makes it useful — the listings are in the HTML, not assembled by a script
 * after the page loads, so no browser is needed. Its robots.txt is `Allow: /`.
 *
 * Two things shape how it is read.
 *
 * It is read country by country, not as one board. Walking the whole thing
 * was tried first, on the assumption that the pipeline's country filter would
 * tidy up afterwards: 600 requests returned 22 PE roles and every one of them
 * was in the UAE, Saudi Arabia or Oman, none of which are wanted. That filter
 * also runs at export rather than collection, so the vacancies were stored
 * and then silently hidden. This site's inventory is overwhelmingly Gulf, so
 * the only economical way to read it is to ask for the wanted countries by
 * their own ids.
 *
 * And the `<title>` element is truncated at about seventy characters — "…job
 * in United A" — so the title is taken from the listing row, where it is
 * whole, and the detail page supplies the rest. The country comes from the
 * breadcrumb, which is the only place on the page that states it plainly.
 */

import { fetchText } from "../core/http.ts";
import { log } from "../core/logger.ts";
import { htmlToText, toIso } from "../core/text.ts";
import { allCountries } from "../locations.ts";
import type { RawJob, Salary } from "../core/types.ts";
import type { ScrapeContext, Source } from "./base.ts";

const ORIGIN = "https://www.seekteachers.com";

/**
 * Drop HTML comments before reading anything.
 *
 * These pages carry commented-out template markup with example values still
 * in it — `<!-- <span>Salary:</span>£35,000 per year-->` sits on every
 * vacancy. Read naively it produced the same invented salary for every job on
 * the board, which is worse than reporting none.
 */
const live = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, " ");

/**
 * The site's own country ids, for the configured countries it carries.
 *
 * Harvested from its Location filter, which shows a different subset on every
 * page — these came from several. The rest of the configured list (Vietnam,
 * India, Japan, Peru and so on) it simply does not cover, and asking for a
 * country it has no id for would fetch the whole board again.
 */
const COUNTRY_IDS: Record<string, number> = {
  Thailand: 99,
  China: 81,
  Malaysia: 87,
  Singapore: 183,
  Cambodia: 80,
  Laos: 86,
  Taiwan: 98,
  Myanmar: 91,
  Indonesia: 84,
  "South Korea": 96,
  Uzbekistan: 23,
  Turkey: 21,
  Colombia: 175,
};

/** Pages per country. The walk stops earlier when a page adds nothing new. */
const MAX_PAGES = 12;

/** Vacancy ids on a listing page, with the title as the row prints it. */
export function listingEntries(html: string): { id: string; title: string }[] {
  const out = new Map<string, string>();
  /*
   * The link is matched on its own and the text window taken separately.
   * Capturing the window in the pattern itself moved the scan past the next
   * link — rows sit closer together than the window is wide — so adjacent
   * vacancies were skipped in pairs.
   */
  for (const m of html.matchAll(/job-detail\.asp\?job_id=(\d+)/gi)) {
    const id = m[1]!;
    if (out.has(id)) continue;
    // The anchors here are not always closed before the next one opens, so a
    // tag-matching read finds nothing; a bounded window does.
    const title = htmlToText(html.slice(m.index! + m[0].length, m.index! + m[0].length + 300))
      .split(/[\n•]/)
      .map((s) => s.trim())
      .find((s) => s.length > 3 && !/^(read more|apply|view)$/i.test(s));
    if (title) out.set(id, title.slice(0, 180));
  }
  return [...out].map(([id, title]) => ({ id, title }));
}

/**
 * The country, from the breadcrumb.
 *
 * It reads `home > permanent > united arab emirates > …`, so the country is
 * not at a fixed position and the crumbs around it are not countries. They
 * are therefore checked against the configured country list — `countryName`
 * cannot do this, as it normalises rather than validates and hands back
 * "home" unchanged, which is how every vacancy came to be filed under it.
 */
export function countryFromCrumbs(html: string, known = countryLookup()): string | undefined {
  const bar = live(html).match(/breadcrumb[^>]*>([\s\S]{0,600}?)<\/(?:ul|ol|nav|div|p)>/i);
  if (!bar) return undefined;
  for (const crumb of htmlToText(bar[1]!).split(/[>›|•]/)) {
    const hit = known.get(crumb.trim().toLowerCase());
    if (hit) return hit;
  }
  return undefined;
}

/** Lower-cased country name -> its proper spelling. Built once per run. */
let lookup: Map<string, string> | null = null;
export function countryLookup(): Map<string, string> {
  if (lookup) return lookup;
  lookup = new Map();
  for (const c of allCountries()) lookup.set(c.name.toLowerCase(), c.name);
  return lookup;
}

/** A labelled field from the detail table, e.g. "Deadline" -> "Oct 31, 2026". */
export function labelled(html: string, label: string): string | undefined {
  const re = new RegExp(
    `>\\s*${label}\\s*:?\\s*<\\/(?:strong|b|span|td|label|dt|div)>\\s*(?:<[^>]*>\\s*)*([^<]{1,160})`,
    "i",
  );
  const value = live(html).match(re)?.[1];
  if (!value) return undefined;
  const clean = htmlToText(value).replace(/\s+/g, " ").trim();
  return clean.length > 1 ? clean : undefined;
}

/** "£35,000 per year" and the like, as far as it can be read. */
export function parseSalary(raw: string | undefined): Salary | undefined {
  if (!raw) return undefined;
  const text = raw.replace(/-->/g, "").trim();
  if (!text) return undefined;
  const nums = [...text.matchAll(/([\d][\d,]{2,})/g)].map((m) => Number(m[1]!.replace(/,/g, "")));
  const currency = /£|GBP/.test(text) ? "GBP" : /\$|USD/.test(text) ? "USD" : /€|EUR/.test(text) ? "EUR" : undefined;
  const period = /per year|annum|annual|yearly/i.test(text)
    ? "year"
    : /per month|monthly|pcm/i.test(text)
      ? "month"
      : undefined;
  if (!nums.length) return { text };
  return { min: Math.min(...nums), max: Math.max(...nums), currency, period, text };
}

export function parseDetail(html: string, id: string, listingTitle: string): RawJob | null {
  const url = `${ORIGIN}/job-detail.asp?job_id=${id}`;
  const title = listingTitle.trim();
  if (!title) return null;

  const country = countryFromCrumbs(html);
  // The row prints "Role - City - start", so the middle part is usually the
  // city. Only trusted when it is not obviously something else.
  const parts = title.split(/\s+-\s+/).map((p) => p.trim());
  const city = parts.length > 2 && parts[1] && !/asap|start|permanent|full|part/i.test(parts[1]) ? parts[1] : undefined;

  const description = (() => {
    const body = live(html).match(/<h1[^>]*>\s*Description\s*<\/h1>([\s\S]{0,12000})/i);
    return body ? htmlToText(body[1]!).slice(0, 8000) : undefined;
  })();

  const benefits = labelled(html, "Benefits");

  return {
    source: "seekteachers",
    sourceJobId: id,
    title: parts[0] || title,
    url,
    country,
    city,
    description,
    deadlineAt: toIso(labelled(html, "Deadline")),
    startDate: labelled(html, "Job Start Date"),
    salary: parseSalary(labelled(html, "Salary")),
    contractType: labelled(html, "Type of Post"),
    ...(benefits ? { benefits: [benefits] } : {}),
    applicationUrl: url,
    raw: { id },
  };
}

async function collect(ctx: ScrapeContext): Promise<RawJob[]> {
  const found = new Map<string, string>();

  for (const [country, countryId] of Object.entries(COUNTRY_IDS)) {
    let added = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = `${ORIGIN}/jobs.asp?country_id=${countryId}${page > 1 ? `&page=${page}` : ""}`;
      const html = await fetchText(url, {
        soft: true, fresh: ctx.fresh, retries: 1, timeoutMs: 25000, label: `seekteachers ${country} p${page}`,
      });
      if (!html) break;

      const before = found.size;
      for (const { id, title } of listingEntries(html)) if (!found.has(id)) found.set(id, title);
      added += found.size - before;
      // A page adding nothing is the end of this country's list, whatever the
      // pager claims: the site serves the last page again rather than a 404.
      if (found.size === before) break;
      if (ctx.maxJobs && found.size >= ctx.maxJobs) break;
    }
    if (added) log.debug(`SeekTeachers: ${country} — ${added} vacancies`);
    if (ctx.maxJobs && found.size >= ctx.maxJobs) break;
  }

  const wanted = ctx.maxJobs ? [...found].slice(0, ctx.maxJobs) : [...found];
  log.info(`SeekTeachers: ${wanted.length} vacancies across ${Object.keys(COUNTRY_IDS).length} countries, reading each one`);

  const jobs: RawJob[] = [];
  for (const [id, title] of wanted) {
    const html = await fetchText(`${ORIGIN}/job-detail.asp?job_id=${id}`, {
      soft: true, fresh: ctx.fresh, retries: 0, timeoutMs: 25000, label: "seekteachers job",
    });
    if (!html) continue;
    const job = parseDetail(html, id, title);
    if (job) jobs.push(job);
  }
  return jobs;
}

export const seekTeachersSource: Source = {
  id: "seekteachers",
  label: "SeekTeachers",
  note: "server-rendered board, read country by country — it is mostly Gulf, so only the configured countries are asked for",
  collect,
};
