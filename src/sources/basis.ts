/**
 * BASIS International Schools (jobs.basisinternationalschools.com).
 *
 * A high-paying group with campuses across China (Shenzhen, Guangzhou,
 * Chengdu, Beijing, Hangzhou and more) and Thailand. Its careers site is a
 * Phenom portal, which looks like a JavaScript app but carries each results
 * page's jobs as JSON inside the HTML ("eagerLoadRefineSearch"), ten at a
 * time, paged with ?from=N. No browser and no token needed; robots.txt has no
 * matching rule.
 *
 * The school is named in the first words of the teaser ("BASIS International
 * School Shenzhen is seeking ...").
 */

import { fetchText } from "../core/http.ts";
import { htmlToText, slugify } from "../core/text.ts";
import type { RawJob } from "../core/types.ts";
import type { ScrapeContext, Source } from "./base.ts";

const ORIGIN = "https://jobs.basisinternationalschools.com/global/en";
const PAGE_SIZE = 10;
/** 120 jobs made twelve pages in November 2026; the cap only stops a runaway. */
const MAX_PAGES = 30;

export interface PhenomJob {
  jobId: string;
  title: string;
  city?: string;
  country?: string;
  postedDate?: string;
  type?: string;
  descriptionTeaser?: string;
}

/** The jobs embedded in one Phenom results page, or null if the block is missing. */
export function embeddedJobs(html: string): { jobs: PhenomJob[]; total: number } | null {
  const at = html.indexOf('"eagerLoadRefineSearch"');
  if (at < 0) return null;
  const block = html.slice(at);
  const total = Number(block.match(/"totalHits":(\d+)/)?.[1] ?? 0);
  const m = block.match(/"data":\{"jobs":(\[[\s\S]*?\])\s*,"aggregations"/);
  if (!m) return null;
  return { jobs: JSON.parse(m[1]!) as PhenomJob[], total };
}

export function toRawJob(j: PhenomJob): RawJob | null {
  if (!j.jobId || !j.title) return null;
  const url = `${ORIGIN}/job/${j.jobId}/${slugify(j.title)}`;
  return {
    source: "basis",
    sourceJobId: j.jobId,
    title: j.title.trim(),
    url,
    schoolName: j.descriptionTeaser?.match(/^(BASIS\b.*?) is (?:seeking|looking|hiring)/)?.[1]?.trim(),
    country: j.country || undefined,
    city: j.city || undefined,
    postedAt: j.postedDate ? new Date(j.postedDate.replace(/\+0000$/, "Z")).toISOString() : undefined,
    contractType: j.type || undefined,
    description: j.descriptionTeaser ? htmlToText(j.descriptionTeaser) : undefined,
    applicationUrl: url,
    raw: { ...j, descriptionTeaser: undefined } as unknown as Record<string, unknown>,
  };
}

async function collect(ctx: ScrapeContext): Promise<RawJob[]> {
  const jobs = new Map<string, RawJob>();
  for (let page = 0; page < MAX_PAGES; page++) {
    // The default order shifts between requests and skipped ~14 of 120 jobs; date order is stable.
    const html = await fetchText(`${ORIGIN}/search-results?from=${page * PAGE_SIZE}&sortBy=Most%20recent`, {
      soft: true, fresh: ctx.fresh, retries: 1, timeoutMs: 25000, label: `basis p${page + 1}`,
    });
    const res = html ? embeddedJobs(html) : null;
    if (!res?.jobs.length) break;
    const before = jobs.size;
    for (const j of res.jobs) {
      const job = toRawJob(j);
      if (job) jobs.set(job.sourceJobId, job);
    }
    if (jobs.size === before || jobs.size >= res.total) break;
    if (ctx.maxJobs && jobs.size >= ctx.maxJobs) break;
  }
  const out = [...jobs.values()];
  return ctx.maxJobs ? out.slice(0, ctx.maxJobs) : out;
}

export const basisSource: Source = {
  id: "basis",
  label: "BASIS International",
  note: "group careers site (Phenom), jobs read from the JSON in each results page; school named",
  collect,
};
