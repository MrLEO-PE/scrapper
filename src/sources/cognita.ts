/**
 * Cognita (cognitapeople.csod.com).
 *
 * A group of around a hundred schools, many of them international (Singapore,
 * Hong Kong, Vietnam, the Gulf, Spain), recruiting through one Cornerstone
 * OnDemand career site. Like Nord Anglia and Inspired, it is an employer
 * rather than a board, so roles appear here that never reach an aggregator.
 *
 * The career site is a JavaScript app. reverse-api-engineer found the search
 * it calls:
 *
 *   POST uk.api.csod.com/rec-job-search/external/jobs       (no robots.txt)
 *   GET  cognitapeople.csod.com/services/x/job-requisition/v2/requisitions/{id}/jobDetails
 *
 * Both want the anonymous bearer token the career page hands every visitor,
 * embedded in its HTML. That page is fetched fresh each run, never from the
 * cache: the token lasts about an hour and the cache keeps pages for six.
 *
 * The search names no school; the detail record does (primaryLocation.title).
 * The career site asks for ten seconds between requests, so details are read
 * only for vacancies that are kept.
 *
 * Only PE posts in your countries (config/directory.json) are kept. Most of
 * Cognita's 130-odd posts are in the UK, Spain, India, the Gulf and the US.
 */

import { fetchJson, fetchText } from "../core/http.ts";
import { log } from "../core/logger.ts";
import { countryName, htmlToText } from "../core/text.ts";
import { targetCountries, vacancyInScope } from "../directoryconfig.ts";
import type { RawJob } from "../core/types.ts";
import { classify } from "../match/classify.ts";
import type { ScrapeContext, Source } from "./base.ts";

const CORP = "cognitapeople";
const SITE = "https://cognitapeople.csod.com";
const API = "https://uk.api.csod.com";
const PAGE_SIZE = 50;
const MAX_PAGES = 20;

export interface Requisition {
  requisitionId: number;
  displayJobTitle: string;
  postingEffectiveDate?: string;
  postingExpirationDate?: string;
  locations?: { city?: string; state?: string; country?: string }[];
}

interface SearchResponse {
  data?: { totalCount?: number; requisitions?: Requisition[] };
}

interface DetailResponse {
  data?: { primaryLocation?: { title?: string }; externalDescription?: string };
}

/** The anonymous token the career page embeds for its own script. */
export function tokenFrom(html: string): string | undefined {
  return html.match(/"token":"(eyJ[^"]+)"/)?.[1];
}

/** "25/11/2026" -> "2026-11-25"; anything else is passed through. */
export function isoDate(d: string | undefined): string | undefined {
  if (!d) return undefined;
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : d;
}

export function toRawJob(r: Requisition): RawJob | null {
  if (!r.requisitionId || !r.displayJobTitle) return null;
  const loc = r.locations?.[0] ?? {};
  const url = `${SITE}/ux/ats/careersite/1/home/requisition/${r.requisitionId}?c=${CORP}`;
  return {
    source: "cognita",
    sourceJobId: String(r.requisitionId),
    title: r.displayJobTitle.trim(),
    url,
    country: loc.country?.toUpperCase() || undefined,
    city: loc.city || loc.state || undefined,
    postedAt: isoDate(r.postingEffectiveDate),
    deadlineAt: isoDate(r.postingExpirationDate),
    applicationUrl: url,
    raw: r as unknown as Record<string, unknown>,
  };
}

/** A PE post in one of the wanted countries (an unknown country is kept). */
export function fitsYou(job: RawJob, targets: Set<string>): boolean {
  return classify(job.title).isPe && vacancyInScope(countryName(job.country), targets);
}

async function collect(ctx: ScrapeContext): Promise<RawJob[]> {
  const page = await fetchText(`${SITE}/ux/ats/careersite/1/home?c=${CORP}`, {
    fresh: true, soft: true, retries: 1, timeoutMs: 25000, label: "cognita token",
  });
  const token = page ? tokenFrom(page) : undefined;
  if (!token) {
    log.warn("Cognita: no token on the career page, skipping");
    return [];
  }
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json", "csod-accept-language": "en-GB" };

  const jobs = new Map<string, RawJob>();
  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
    const res = await fetchJson<SearchResponse>(`${API}/rec-job-search/external/jobs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        careerSiteId: 1, careerSitePageId: 1, pageNumber, pageSize: PAGE_SIZE, cultureId: 2, searchText: "",
        cultureName: "en-GB", states: [], countryCodes: [], cities: [], placeID: "", radius: null,
        postingsWithinDays: null, customFieldCheckboxKeys: [], customFieldDropdowns: [], customFieldRadios: [],
      }),
      soft: true, retries: 1, timeoutMs: 25000, label: `cognita p${pageNumber}`,
    });
    const reqs = res?.data?.requisitions ?? [];
    for (const r of reqs) {
      const job = toRawJob(r);
      if (job) jobs.set(job.sourceJobId, job);
    }
    if (reqs.length < PAGE_SIZE || jobs.size >= (res?.data?.totalCount ?? 0)) break;
    if (ctx.maxJobs && jobs.size >= ctx.maxJobs) break;
  }

  const targets = targetCountries();
  const out = [...jobs.values()].filter((j) => fitsYou(j, targets));
  log.debug(`Cognita: ${out.length} PE posts in your countries of ${jobs.size}`);
  const wanted = ctx.maxJobs ? out.slice(0, ctx.maxJobs) : out;

  // School name (and, with --deep, the advert) for each kept post.
  for (const job of wanted) {
    const d = await fetchJson<DetailResponse>(
      `${SITE}/services/x/job-requisition/v2/requisitions/${job.sourceJobId}/jobDetails?cultureId=2`,
      { headers, soft: true, fresh: ctx.fresh, retries: 0, timeoutMs: 20000, label: "cognita job" },
    );
    const school = d?.data?.primaryLocation?.title?.trim();
    if (school) job.schoolName = school;
    if (ctx.deep && d?.data?.externalDescription) job.description = htmlToText(d.data.externalDescription).slice(0, 8000);
  }
  return wanted;
}

export const cognitaSource: Source = {
  id: "cognita",
  label: "Cognita",
  // Uses the visitor token the career page embeds; the user approved this on 2026-11-23.
  note: "group careers site (Cornerstone) through its JSON search; only PE posts in your countries; school named",
  collect,
};
