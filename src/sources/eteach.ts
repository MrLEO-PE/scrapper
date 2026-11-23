/**
 * Eteach, international vacancies (www.eteach.com).
 *
 * Mostly a UK board, but its "international" search carries around seventy
 * posts outside the UK, mainly the Gulf, Spain and Switzerland, with the
 * school named on every one. The first run found two Heads of PE.
 *
 * It was once ruled out as a JavaScript shell: www.eteach.com holds no job
 * data in its HTML. reverse-api-engineer found the public JSON API the page
 * calls, on its own host, which has no robots.txt:
 *
 *   GET candidate-api.eteach.com/api/search/results?international=true&page=N
 *   GET candidate-api.eteach.com/api/vacancy/details/{id}     (--deep only)
 *
 * The whole international list is read and the PE filter does the rest. It
 * is small enough that asking the board to filter would only lose the
 * leadership posts it files under other subjects.
 */

import { fetchJson } from "../core/http.ts";
import { htmlToText } from "../core/text.ts";
import type { RawJob } from "../core/types.ts";
import type { ScrapeContext, Source } from "./base.ts";

const API = "https://candidate-api.eteach.com/api";
const SITE = "https://www.eteach.com";
/** Four pages of ~21 in November 2026; the cap only stops a runaway. */
const MAX_PAGES = 15;

export interface EteachJob {
  id: number;
  title: string;
  url: string;
  schoolName?: string;
  location?: string;
  salary?: string | null;
  released?: string;
  expires?: string;
  hasExpired?: boolean;
}

interface SearchResponse {
  results?: { job?: EteachJob | null }[];
  isLastPage?: boolean;
}

interface Details {
  contractType?: string;
  contractLength?: string;
  localisations?: Record<string, { description?: string }>;
}

export function toRawJob(j: EteachJob): RawJob | null {
  if (!j.id || !j.title || !j.url || j.hasExpired) return null;
  // "Jeddah, Saudi Arabia": the country is the last part, the city the first.
  const parts = (j.location ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const url = SITE + j.url;
  return {
    source: "eteach",
    sourceJobId: String(j.id),
    title: j.title.trim(),
    url,
    schoolName: j.schoolName?.trim() || undefined,
    country: parts.length ? parts[parts.length - 1]!.replace(/\s*\(remote\)$/i, "") : undefined,
    city: parts.length > 1 ? parts[0] : undefined,
    postedAt: j.released,
    deadlineAt: j.expires,
    ...(j.salary?.trim() ? { salary: { text: j.salary.trim() } } : {}),
    applicationUrl: url,
    raw: j as unknown as Record<string, unknown>,
  };
}

async function collect(ctx: ScrapeContext): Promise<RawJob[]> {
  const jobs = new Map<string, RawJob>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetchJson<SearchResponse>(
      `${API}/search/results?page=${page}&facetsOnly=false&site=Eteachnew&deviceType=Desktop&international=true`,
      { soft: true, fresh: ctx.fresh, retries: 1, timeoutMs: 20000, label: `eteach p${page}` },
    );
    if (!res?.results?.length) break;
    for (const r of res.results) {
      const job = r.job ? toRawJob(r.job) : null;
      if (job) jobs.set(job.sourceJobId, job);
    }
    if (res.isLastPage) break;
    if (ctx.maxJobs && jobs.size >= ctx.maxJobs) break;
  }

  const out = [...jobs.values()];
  const wanted = ctx.maxJobs ? out.slice(0, ctx.maxJobs) : out;
  if (!ctx.deep) return wanted;

  // The listing has no prose; the detail record carries the advert itself.
  for (const job of wanted) {
    const d = await fetchJson<Details>(`${API}/vacancy/details/${job.sourceJobId}`, {
      soft: true, fresh: ctx.fresh, retries: 0, timeoutMs: 20000, label: "eteach job",
    });
    if (!d) continue;
    const body = d.localisations?.en?.description ?? Object.values(d.localisations ?? {})[0]?.description;
    if (body) job.description = htmlToText(body).slice(0, 8000);
    if (d.contractType) job.contractType = d.contractType;
    if (d.contractLength) job.contractTerm = d.contractLength;
  }
  return wanted;
}

export const eteachSource: Source = {
  id: "eteach",
  label: "Eteach",
  note: "international (non-UK) vacancies through its public JSON search; school named; --deep reads each advert",
  collect,
};
