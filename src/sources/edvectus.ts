/**
 * Edvectus (app.edvectus.com).
 *
 * A recruitment agency's board, strong on China, Malaysia and the Gulf, and
 * one of the few that states pay on nearly every vacancy.
 *
 * It was once ruled out as a script-only page: the vacancies page is a Blazor
 * app with nothing in its HTML. reverse-api-engineer found what the app calls
 * underneath, a public JSON search, and that is what this reads:
 *
 *   GET  /api/lists/jobroles       role ids, grouped by category
 *   POST /api/search/jobs          { parameters: { jobRoleId: [...], page, pageSize, ... } }
 *
 * robots.txt allows /vacancies and disallows nothing.
 *
 * Roles are looked up by name on each run rather than hard-coded, so a
 * renumbered role is still found. Two kinds are asked for: the PE roles, and
 * the subject-leadership roles (head of department, subject leader), which is
 * where a Head of PE is filed when the agency does not use a PE role.
 *
 * The school is never named: this is an agency, and it hides the client.
 */

import { fetchJson } from "../core/http.ts";
import { log } from "../core/logger.ts";
import { slugify } from "../core/text.ts";
import type { RawJob, Salary } from "../core/types.ts";
import type { ScrapeContext, Source } from "./base.ts";

const ORIGIN = "https://app.edvectus.com";

/** The largest page the board's own UI offers. */
const PAGE_SIZE = 50;
const MAX_PAGES = 10;

interface RoleGroup {
  category: string;
  selectListItems: { text: string; value: string }[];
}

export interface EdvectusJob {
  jobId: number;
  jobRefNo: string;
  jobTitle: string;
  startDate?: string;
  createdOn?: string;
  location?: string;
  jobCountryCode?: string;
  ageRange?: string;
  currencysymbol?: string;
  minBasic?: number;
  maxBasic?: number;
  publishedJobDescription?: string;
  housing?: string;
  benefitsJOB?: string;
}

interface SearchResponse {
  wrappedJobSearch?: { jobs?: EdvectusJob[]; total?: number | string; searchFailed?: boolean; errorMessage?: string };
}

/** PE roles, plus the subject-leadership roles a Head of PE may be filed under. */
export function wantedRoleIds(groups: RoleGroup[]): string[] {
  const ids = new Set<string>();
  for (const g of groups) {
    for (const r of g.selectListItems) {
      if (/physical education|\bp\.?e\.?\b|sport/i.test(r.text)) ids.add(r.value);
      else if (/leadership/i.test(g.category) && /head of department|subject leader/i.test(r.text)) ids.add(r.value);
    }
  }
  return [...ids];
}

/**
 * Pay as stated. The board gives no period, and its figures are monthly in
 * Asia and annual in sterling, so the period is left unset rather than
 * guessed. A 0 is the board's blank, not a salary.
 */
export function salaryOf(j: EdvectusJob): Salary | undefined {
  const min = j.minBasic || undefined;
  const max = j.maxBasic || undefined;
  if (!min && !max) return undefined;
  return { ...(min ? { min } : {}), ...(max ? { max } : {}), ...(j.currencysymbol ? { currency: j.currencysymbol } : {}) };
}

export function toRawJob(j: EdvectusJob): RawJob | null {
  if (!j.jobRefNo || !j.jobTitle) return null;
  // "UAE - Dubai" or just "Malaysia": the city, where given, follows the dash.
  const [place, city] = (j.location ?? "").split(/\s+-\s+/).map((s) => s.trim() || undefined);
  const benefits = [j.housing, j.benefitsJOB].map((b) => b?.trim()).filter((b): b is string => !!b);
  const url = `${ORIGIN}/vacancies/${j.jobRefNo}-${slugify(j.jobTitle)}`;

  return {
    source: "edvectus",
    sourceJobId: String(j.jobId),
    title: j.jobTitle.trim(),
    url,
    // The location text first: the country code is not reliable (a Dubai
    // vacancy carried "GB", the agency's own country).
    country: place || j.jobCountryCode || undefined,
    city,
    postedAt: j.createdOn,
    startDate: j.startDate,
    salary: salaryOf(j),
    gradeLevels: j.ageRange ? j.ageRange.split(/,\s*/) : undefined,
    ...(benefits.length ? { benefits } : {}),
    description: j.publishedJobDescription?.trim() || undefined,
    applicationUrl: url,
    raw: j as unknown as Record<string, unknown>,
  };
}

async function collect(ctx: ScrapeContext): Promise<RawJob[]> {
  const roles = await fetchJson<{ jobRoles: RoleGroup[] }>(`${ORIGIN}/api/lists/jobroles?onlyWithJobs=false`, {
    soft: true, fresh: ctx.fresh, retries: 1, timeoutMs: 20000, label: "edvectus roles",
  });
  const jobRoleId = roles ? wantedRoleIds(roles.jobRoles) : [];
  if (!jobRoleId.length) {
    log.warn("Edvectus: no PE or subject-leadership roles in the role list, skipping");
    return [];
  }

  const jobs = new Map<number, RawJob>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const parameters = {
      jobRoleId, locationId: [], ageRangeId: [], sectorId: [], startDateRangeId: [], curriculaId: [],
      suitableForNqt: null, familyFriendly: null, page, pageSize: PAGE_SIZE, sort: "newest",
    };
    const res = await fetchJson<SearchResponse>(`${ORIGIN}/api/search/jobs`, {
      method: "POST",
      body: JSON.stringify({ parameters }),
      headers: { "content-type": "application/json" },
      soft: true, fresh: ctx.fresh, retries: 1, timeoutMs: 20000, label: `edvectus p${page}`,
    });
    const found = res?.wrappedJobSearch;
    if (!found || found.searchFailed) {
      if (found?.errorMessage) log.warn(`Edvectus: ${found.errorMessage}`);
      break;
    }
    for (const j of found.jobs ?? []) {
      const job = toRawJob(j);
      if (job) jobs.set(j.jobId, job);
    }
    if ((found.jobs?.length ?? 0) < PAGE_SIZE || jobs.size >= Number(found.total ?? 0)) break;
    if (ctx.maxJobs && jobs.size >= ctx.maxJobs) break;
  }

  const out = [...jobs.values()];
  return ctx.maxJobs ? out.slice(0, ctx.maxJobs) : out;
}

export const edvectusSource: Source = {
  id: "edvectus",
  label: "Edvectus",
  note: "agency board read through its public JSON search; PE and subject-leadership roles; school not named",
  collect,
};
