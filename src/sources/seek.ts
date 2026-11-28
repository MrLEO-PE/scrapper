/**
 * SEEK's job sites: JobsDB (Hong Kong, Thailand) and SEEK (Australia, New Zealand).
 *
 * Schools advertise here that appear on no teaching board: in Hong Kong YK
 * Pao, Malvern College, HKIS, ESF and the AISL (Harrow) schools; in Thailand
 * Brighton College and BPS; in Australia the grammar schools' Heads of Sport.
 *
 * What robots.txt allows decides the shape. It disallows every query string
 * except one that starts `?keywords`, and every job page (`/job/`), so only
 * keyword searches are read (`/jobs?keywords=…&page=N`). The search page
 * embeds its results as JSON (`window.SEEK_REDUX_DATA`): title, employer,
 * location, listing date, teaser and, when shown, the salary. The advert
 * itself is never fetched; the link goes to it for you to read.
 *
 * JobStreet (Singapore, Malaysia, Indonesia, Philippines) runs the same site
 * but answers this scraper with 403, so it is not read.
 *
 * Australia and New Zealand are home markets with thousands of PE posts, so
 * there only leadership searches are run, to keep the sheet about the posts
 * worth moving for. New Zealand's state schools are covered in full by the
 * Education Gazette source.
 */

import { fetchText } from "../core/http.ts";
import { log } from "../core/logger.ts";
import type { RawJob } from "../core/types.ts";
import type { ScrapeContext, Source } from "./base.ts";

interface Site {
  host: string;
  country: string;
  searches: string[];
  /** Results are by relevance, so the first pages hold the matches. */
  pages: number;
}

export const SITES: Site[] = [
  { host: "hk.jobsdb.com", country: "Hong Kong", searches: ["physical education", "PE teacher"], pages: 4 },
  { host: "th.jobsdb.com", country: "Thailand", searches: ["physical education"], pages: 3 },
  { host: "www.seek.com.au", country: "Australia", searches: ["head of sport", "director of sport", "head of physical education"], pages: 2 },
  { host: "www.seek.co.nz", country: "New Zealand", searches: ["head of sport", "director of sport"], pages: 2 },
];

export interface SeekJob {
  id: string;
  title: string;
  companyName?: string;
  advertiser?: { description?: string };
  classifications?: { classification?: { id?: string; description?: string } }[];
  locations?: { label?: string }[];
  listingDate?: string;
  salaryLabel?: string;
  teaser?: string;
  bulletPoints?: string[];
  workTypes?: string[];
}

/** The results embedded in a search page, or null if the page has none. */
export function jobsFrom(html: string): { jobs: SeekJob[]; total: number } | null {
  const m = html.match(/window\.SEEK_REDUX_DATA = (\{[\s\S]*?\});\s*\n/);
  if (!m) return null;
  try {
    const r = JSON.parse(m[1]!).results;
    return { jobs: r?.results?.jobs ?? [], total: r?.totalCount ?? 0 };
  } catch {
    return null;
  }
}

/** Education & Training is classification 6123; a school filed elsewhere still names itself one. */
const fromSchool = (j: SeekJob, employer: string): boolean =>
  !!j.classifications?.some((c) => c.classification?.id === "6123") ||
  /\b(?:school|college|grammar|academy)\b/i.test(employer);

export function toRawJob(site: Site, j: SeekJob): RawJob | null {
  const employer = (j.companyName || j.advertiser?.description || "").trim();
  if (!j.id || !j.title || !employer || !fromSchool(j, employer)) return null;
  const url = `https://${site.host}/job/${j.id}`;
  const blurb = [j.teaser, ...(j.bulletPoints ?? [])].filter(Boolean).join("\n");
  return {
    source: "seek",
    sourceJobId: `${site.host}:${j.id}`,
    title: j.title.replace(/\s+/g, " ").trim(),
    url,
    schoolName: employer,
    country: site.country,
    city: j.locations?.[0]?.label || undefined,
    postedAt: j.listingDate,
    description: blurb || undefined,
    ...(j.salaryLabel?.trim() ? { salary: { text: j.salaryLabel.trim() } } : {}),
    contractType: j.workTypes?.join(", ") || undefined,
    applicationUrl: url,
    raw: { host: site.host, id: j.id },
  };
}

async function collect(ctx: ScrapeContext): Promise<RawJob[]> {
  const jobs = new Map<string, RawJob>();
  for (const site of SITES) {
    for (const q of site.searches) {
      for (let page = 1; page <= site.pages; page++) {
        // `?keywords` must lead: robots.txt allows only query strings that start with it.
        // JobsDB answers quick runs of searches with 429; the retries back off and honour Retry-After.
        const url = `https://${site.host}/jobs?keywords=${encodeURIComponent(q)}${page > 1 ? `&page=${page}` : ""}`;
        const html = await fetchText(url, { soft: true, fresh: ctx.fresh, retries: 3, timeoutMs: 30000, label: `seek ${site.host} "${q}" p${page}` });
        const res = html ? jobsFrom(html) : null;
        if (!res) {
          if (page === 1) log.warn(`${site.host}: no results page for "${q}"`);
          break;
        }
        for (const j of res.jobs) {
          const job = toRawJob(site, j);
          if (job) jobs.set(job.sourceJobId, job);
        }
        if (!res.jobs.length || page * res.jobs.length >= res.total) break;
      }
    }
    if (ctx.maxJobs && jobs.size >= ctx.maxJobs) break;
  }
  const out = [...jobs.values()];
  return ctx.maxJobs ? out.slice(0, ctx.maxJobs) : out;
}

export const seekSource: Source = {
  id: "seek",
  label: "JobsDB / SEEK",
  note: "JobsDB Hong Kong and Thailand, SEEK Australia and New Zealand (leadership searches); keyword search pages only, as robots.txt allows; school named",
  collect,
};
