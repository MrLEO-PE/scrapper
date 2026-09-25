/**
 * School groups that recruit through Workday.
 *
 * The same idea as the SuccessFactors source: one integration covers every
 * school in the group, which is far better value than chasing their sites one
 * at a time. International Schools Partnership alone runs over a hundred
 * schools, many of them in the configured countries, and it posts to Workday
 * before — or instead of — the boards.
 *
 * Workday's career sites are backed by a documented JSON API (`/wday/cxs/...`)
 * that the page itself calls, so there is no HTML to parse and nothing to
 * reverse-engineer. The list gives titles and locations; the detail endpoint
 * gives the full description, which is what the PE classifier and the package
 * extraction need.
 */

import { fetchJson, fetchText } from "../core/http.ts";
import { log } from "../core/logger.ts";
import { htmlToText } from "../core/text.ts";
import type { RawJob, SourceId } from "../core/types.ts";
import { detectApplicationForm } from "../match/appform.ts";
import type { ScrapeContext, Source } from "./base.ts";

export interface WorkdaySite {
  id: SourceId;
  label: string;
  /** Host, e.g. "internationalschools.wd3.myworkdayjobs.com". */
  host: string;
  /** Workday tenant, the first path segment under /wday/cxs/. */
  tenant: string;
  /** Career site name, e.g. "ISPCareers". */
  site: string;
  /**
   * Search terms to run. Workday's search is loose — "physical education"
   * returns plenty that is not — but the classifier filters, and a narrow
   * search misses roles the group files under a sport rather than a subject.
   */
  searches: string[];
}

export const WORKDAY_SITES: WorkdaySite[] = [
  {
    id: "isp",
    label: "International Schools Partnership",
    host: "internationalschools.wd3.myworkdayjobs.com",
    tenant: "internationalschools",
    site: "ISPCareers",
    searches: ["physical education", "PE teacher", "sport", "swimming", "games"],
  },
];

interface ListItem {
  title?: string;
  externalPath?: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
}

interface ListResponse {
  total?: number;
  jobPostings?: ListItem[];
}

interface DetailResponse {
  jobPostingInfo?: {
    id?: string;
    title?: string;
    jobDescription?: string;
    location?: string;
    country?: { descriptor?: string };
    startDate?: string;
    endDate?: string;
    jobReqId?: string;
    externalUrl?: string;
    timeType?: string;
  };
}

const cxs = (s: WorkdaySite): string => `https://${s.host}/wday/cxs/${s.tenant}/${s.site}`;

/** Links inside a description, so an attached application form is spotted. */
function linksIn(html: string): { url: string; text?: string }[] {
  const out: { url: string; text?: string }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,160}?)<\/a>/gi)) {
    out.push({ url: m[1]!, text: htmlToText(m[2] ?? "").trim() });
  }
  return out;
}

/**
 * "APS International, Malaysia, Kuala Lumpur" -> school, country, city.
 *
 * Workday joins the location hierarchy with commas, and for these groups the
 * first element is the school. Two elements means no city was recorded; a
 * single element is a school with no location at all, which happens.
 */
export function splitLocations(value?: string): { school?: string; country?: string; city?: string } {
  if (!value) return {};
  const parts = value.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) {
    // Anything past the third is a sub-campus; the city is the last element.
    return { school: parts[0], country: parts[1], city: parts[parts.length - 1] };
  }
  if (parts.length === 2) return { school: parts[0], country: parts[1] };
  return { school: parts[0] };
}

/** Workday says "Posted 3 Days Ago"; there is a real date on the detail. */
async function fetchDetail(site: WorkdaySite, path: string, ctx: ScrapeContext) {
  return fetchJson<DetailResponse>(cxs(site) + path, {
    soft: true,
    fresh: ctx.fresh,
    retries: 1,
    timeoutMs: 20000,
    label: `workday detail ${path}`,
  });
}

async function collectSite(site: WorkdaySite, ctx: ScrapeContext): Promise<RawJob[]> {
  const found = new Map<string, RawJob>();

  for (const searchText of site.searches) {
    if (ctx.maxJobs && found.size >= ctx.maxJobs) break;

    // Workday pages in blocks of 20 and reports the total, so stop at the end
    // rather than guessing a page count.
    for (let offset = 0; offset < 200; offset += 20) {
      const body = JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText });
      const res = await fetchJson<ListResponse>(cxs(site) + "/jobs", {
        method: "POST",
        body,
        headers: { "Content-Type": "application/json" },
        soft: true,
        fresh: ctx.fresh,
        retries: 1,
        timeoutMs: 25000,
        label: `workday ${site.id} "${searchText}" @${offset}`,
      });

      const postings = res?.jobPostings ?? [];
      if (!postings.length) break;

      for (const p of postings) {
        if (!p.title || !p.externalPath) continue;
        const id = p.bulletFields?.[0] ?? p.externalPath;
        if (found.has(id)) continue;

        const where = splitLocations(p.locationsText);
        found.set(id, {
          source: site.id,
          sourceJobId: id,
          title: p.title,
          url: `https://${site.host}/${site.site}${p.externalPath}`,
          // Without a school the group itself is the employer, as elsewhere.
          schoolName: where.school || site.label,
          country: where.country,
          city: where.city,
          raw: p,
        });
      }

      if (offset + postings.length >= (res?.total ?? 0)) break;
    }
  }

  /*
   * Detail pages carry the description, and the description is what decides
   * whether a role is PE at all. Fetching every one would be wasteful, so only
   * the plausible ones are opened — the same approach TES uses.
   */
  const worthOpening = /\b(?:PE|P\.E\.|physical|sport|sports|games|swim|swimming|athletic|athletics|fitness|coach|coaching|health\s+and\s+physical)\b/i;
  const candidates = [...found.values()].filter((j) => worthOpening.test(j.title));
  log.info(`${site.label}: ${found.size} postings, opening ${candidates.length} that look PE-linked`);

  for (const job of candidates) {
    const path = (job.raw as ListItem).externalPath!;
    const detail = await fetchDetail(site, path, ctx);
    const info = detail?.jobPostingInfo;
    if (!info) continue;

    const html = info.jobDescription ?? "";
    job.description = htmlToText(html);
    job.postedAt = info.startDate;
    job.deadlineAt = info.endDate;
    job.contractType = info.timeType;
    if (info.externalUrl) job.url = info.externalUrl;
    if (info.country?.descriptor) job.country = info.country.descriptor;

    job.applicationForm = detectApplicationForm({
      text: job.description,
      links: linksIn(html),
    });
  }

  return [...found.values()];
}

export function createWorkdaySource(site: WorkdaySite): Source {
  return {
    id: site.id,
    label: site.label,
    note: `${site.searches.length} searches against the group's Workday site`,
    async collect(ctx: ScrapeContext): Promise<RawJob[]> {
      try {
        return await collectSite(site, ctx);
      } catch (err) {
        log.warn(`${site.label}: ${(err as Error).message}`);
        return [];
      }
    },
  };
}

export const workdaySources: Source[] = WORKDAY_SITES.map(createWorkdaySource);
