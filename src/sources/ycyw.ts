/**
 * Yew Chung International Schools and Yew Wah International Education Schools.
 *
 * One family of schools in Hong Kong, Shanghai, Beijing, Chongqing, Qingdao
 * and beyond, with two recruitment sites on the same ASP.NET system:
 *
 *   https://jobs.ycis-schools.com/Pages/JobSearch.aspx
 *   https://jobs.ywies.com/Pages/JobSearch.aspx
 *
 * The search page lists the newest twenty posts as a plain HTML table. Later
 * pages come from the table's own page links, which are ordinary ASP.NET form
 * posts (__doPostBack): the next page is the same form sent back with that
 * link as the event target.
 */

import { fetchText } from "../core/http.ts";
import { decodeEntities, htmlToText } from "../core/text.ts";
import type { RawJob } from "../core/types.ts";
import { classify } from "../match/classify.ts";
import type { ScrapeContext, Source } from "./base.ts";

interface Site {
  origin: string;
  school: string;
}

const SITES: Site[] = [
  { origin: "https://jobs.ycis-schools.com", school: "Yew Chung International School" },
  { origin: "https://jobs.ywies.com", school: "Yew Wah International Education School" },
];
const MAX_PAGES = 6;

export interface Row {
  id: string;
  title: string;
  posted?: string;
  location: string;
}

export function rowsFrom(html: string): Row[] {
  const out: Row[] = [];
  const re = /JobDetail\.aspx\?PostID=(\d+)[^>]*>([\s\S]*?)<\/a>\s*<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>/g;
  for (const m of html.matchAll(re)) {
    out.push({ id: m[1]!, title: htmlToText(m[2]!).trim(), posted: m[3]!.trim() || undefined, location: decodeEntities(m[4]!).trim() });
  }
  return out;
}

/** "YCIS - Shanghai(Pudong) (ShanghaiPuDong SEC)" -> the campus, "Shanghai(Pudong)". */
export function campusOf(location: string): string {
  return location.replace(/\s+\([^()]*\)\s*$/, "").replace(/^[A-Z]+\s*-\s*/, "").trim();
}

/** The city and country a campus label names. */
export function placeOf(location: string): { city?: string; country: string } {
  if (/hong kong|-HK\b/i.test(location)) return { city: "Hong Kong", country: "Hong Kong" };
  if (/silicon valley/i.test(location)) return { city: "Silicon Valley", country: "United States" };
  const city = campusOf(location).replace(/\(.*$/, "").trim();
  return { city: city && !/^(YCIS|YWIES|YWIEF|YCYW)$/i.test(city) ? city : undefined, country: "China" };
}

/** "11/16/2026" (month first) -> "2026-11-16". */
export function isoDate(d?: string): string | undefined {
  const m = d?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : undefined;
}

/** The form fields and event target that fetch page `current + 1`, if the table links one. */
export function nextPage(html: string, current: number): { target: string; fields: Record<string, string> } | null {
  const target = html.match(new RegExp(`__doPostBack\\(&#39;(dgPostedJobs\\$[^&]+)&#39;,&#39;&#39;\\)">${current + 1}<`))?.[1];
  if (!target) return null;
  const fields: Record<string, string> = {};
  for (const m of html.matchAll(/<input type="hidden" name="([^"]+)" id="[^"]*" value="([^"]*)"/g)) fields[m[1]!] = decodeEntities(m[2]!);
  return { target, fields };
}

async function collectSite(site: Site, ctx: ScrapeContext): Promise<RawJob[]> {
  const url = `${site.origin}/Pages/JobSearch.aspx`;
  const host = new URL(site.origin).hostname;
  const jobs = new Map<string, RawJob>();
  let html = await fetchText(url, { soft: true, fresh: ctx.fresh, retries: 1, timeoutMs: 25000, label: `${host} p1` });
  for (let page = 1; html && page <= MAX_PAGES; page++) {
    for (const r of rowsFrom(html)) {
      const link = `${site.origin}/Pages/JobDetail.aspx?PostID=${r.id}&Navigation=false`;
      jobs.set(r.id, {
        source: "ycyw",
        sourceJobId: `${host}:${r.id}`,
        title: r.title,
        url: link,
        schoolName: `${site.school} (${campusOf(r.location)})`,
        ...placeOf(r.location),
        postedAt: isoDate(r.posted),
        applicationUrl: link,
        raw: r as unknown as Record<string, unknown>,
      });
    }
    const next = nextPage(html, page);
    if (!next) break;
    const body = new URLSearchParams({ ...next.fields, __EVENTTARGET: next.target, __EVENTARGUMENT: "" }).toString();
    html = await fetchText(url, {
      method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" },
      soft: true, retries: 0, timeoutMs: 25000, label: `${host} p${page + 1}`,
    });
  }
  return [...jobs.values()];
}

async function collect(ctx: ScrapeContext): Promise<RawJob[]> {
  const all: RawJob[] = [];
  for (const site of SITES) all.push(...(await collectSite(site, ctx)));
  const wanted = ctx.maxJobs ? all.slice(0, ctx.maxJobs) : all;
  // The advert text only for posts that look like PE.
  for (const job of wanted.filter((j) => classify(j.title).isPe)) {
    const html = await fetchText(job.url, { soft: true, fresh: ctx.fresh, retries: 0, timeoutMs: 25000, label: "ycyw job" });
    if (html) job.description = htmlToText(html).replace(/\s+/g, " ").slice(0, 8000);
  }
  return wanted;
}

export const ycywSource: Source = {
  id: "ycyw",
  label: "Yew Chung / Yew Wah",
  note: "two group recruitment sites (ASP.NET), newest first; campus named",
  collect,
};
