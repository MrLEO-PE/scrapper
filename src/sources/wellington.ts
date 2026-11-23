/**
 * Wellington College Education, China (wellington.avature.cn).
 *
 * The group behind Wellington and Hiba schools in Shanghai, Tianjin, Hangzhou
 * and Hainan. It was ruled out as a JavaScript shell: its own careers page
 * renders nothing. reverse-api-engineer followed it to an Avature hiring site
 * whose vacancy list is plain server-rendered HTML, six to a page.
 *
 * The route matters. Avature serves the list under both /en_GB/careers/ and
 * /en_GB/jobs/, and robots.txt disallows everything except /*\/jobs (and a few
 * others), so only the /jobs route is read.
 *
 * The list has no school and no posting date. The school ("Business unit")
 * is on the detail page, which is read only for vacancies whose title looks
 * like PE. The site publishes no posting date at all.
 */

import { fetchText } from "../core/http.ts";
import { htmlToText } from "../core/text.ts";
import type { RawJob } from "../core/types.ts";
import { classify } from "../match/classify.ts";
import type { ScrapeContext, Source } from "./base.ts";

const BASE = "https://wellington.avature.cn/en_GB/jobs";
const PAGE_SIZE = 6;
/** 108 vacancies made eighteen pages in November 2026; the cap only stops a runaway. */
const MAX_PAGES = 40;

/** The result cards on one list page. */
export function listingEntries(html: string): { id: string; url: string; title: string; location?: string }[] {
  const out: { id: string; url: string; title: string; location?: string }[] = [];
  for (const m of html.matchAll(/<article class="article article--result"[\s\S]*?<\/article>/g)) {
    const card = m[0];
    const link = card.match(/href="([^"]*\/jobs\/JobDetail\/[^"]*\/(\d+))"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;
    const location = card.match(/list-item-location">([^<]*)</)?.[1]?.trim();
    out.push({ id: link[2]!, url: link[1]!, title: htmlToText(link[3]!).trim(), ...(location ? { location } : {}) });
  }
  return out;
}

/** The "Business unit" field on a detail page, which names the school. */
export function schoolFrom(html: string): string | undefined {
  const raw = html.match(/Business unit\s*<\/div>\s*<div[^>]*>([\s\S]*?)<\/div>/)?.[1];
  return raw ? htmlToText(raw).trim() || undefined : undefined;
}

async function collect(ctx: ScrapeContext): Promise<RawJob[]> {
  const jobs = new Map<string, RawJob>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = page ? `${BASE}/SearchJobs/?jobOffset=${page * PAGE_SIZE}` : BASE;
    const html = await fetchText(url, { soft: true, fresh: ctx.fresh, retries: 1, timeoutMs: 25000, label: `wellington p${page + 1}` });
    if (!html) break;

    const before = jobs.size;
    for (const e of listingEntries(html)) {
      // Recruitment-fair sign-ups share the list with vacancies.
      if (/recruitment fair|registration link/i.test(e.title)) continue;
      jobs.set(e.id, {
        source: "wellington",
        sourceJobId: e.id,
        title: e.title,
        url: e.url,
        country: "China",
        city: e.location,
        applicationUrl: e.url,
        raw: e,
      });
    }
    if (jobs.size === before) break;
    if (ctx.maxJobs && jobs.size >= ctx.maxJobs) break;
  }

  const out = [...jobs.values()];
  const wanted = ctx.maxJobs ? out.slice(0, ctx.maxJobs) : out;
  for (const job of wanted.filter((j) => classify(j.title).isPe)) {
    const html = await fetchText(job.url, { soft: true, fresh: ctx.fresh, retries: 0, timeoutMs: 25000, label: "wellington job" });
    if (!html) continue;
    job.schoolName = schoolFrom(html);
    if (ctx.deep) job.description = htmlToText(html).slice(0, 8000);
  }
  return wanted;
}

export const wellingtonSource: Source = {
  id: "wellington",
  label: "Wellington College China",
  note: "group hiring site (Avature), robots-allowed /jobs route; school named on PE posts; no posting dates",
  collect,
};
