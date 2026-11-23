/**
 * Schools' own hiring sites on BambooHR and Recruitee.
 *
 * The school careers source reads what a careers page shows in its HTML, and
 * a hiring-system widget shows nothing there. A scan of 1,442 schools'
 * careers pages (November 2026) found which systems they link to. Most were
 * application forms or boards already read elsewhere, but two systems publish
 * a public JSON list that needs no login, and their schools are mostly in the
 * wanted countries:
 *
 *   BambooHR   https://{site}.bamboohr.com/careers/list
 *   Recruitee  https://{site}.recruitee.com/api/offers/
 *
 * Each site below is a school or school group found by that scan. Add one by
 * its subdomain; the country is the school's, since BambooHR's own location
 * field is often blank.
 */

import { fetchJson } from "../core/http.ts";
import { log } from "../core/logger.ts";
import { htmlToText } from "../core/text.ts";
import type { RawJob } from "../core/types.ts";
import type { ScrapeContext, Source } from "./base.ts";

export interface AtsSite {
  system: "bamboohr" | "recruitee";
  site: string;
  /** The school; for a group, the department field names the school instead. */
  school?: string;
  country?: string;
}

export const SITES: AtsSite[] = [
  { system: "bamboohr", site: "greenschool", school: "Green School Bali", country: "Indonesia" },
  { system: "bamboohr", site: "cmis", school: "Chiang Mai International School", country: "Thailand" },
  { system: "bamboohr", site: "canacad", school: "Canadian Academy", country: "Japan" },
  { system: "bamboohr", site: "isbusan", school: "International School of Busan", country: "South Korea" },
  { system: "bamboohr", site: "theharbourschool", school: "Harbour School", country: "Hong Kong" },
  { system: "bamboohr", site: "isl", school: "The Island Private School", country: "Cyprus" },
  { system: "recruitee", site: "diponteducation" },
];

interface BambooOpening {
  id: string;
  jobOpeningName: string;
  employmentStatusLabel?: string;
  location?: { city?: string | null; state?: string | null };
}

interface RecruiteeOffer {
  id: number;
  title: string;
  city?: string;
  country?: string;
  department?: string;
  created_at?: string;
  close_at?: string | null;
  careers_url: string;
  description?: string;
  requirements?: string;
}

export function fromBamboo(s: AtsSite, o: BambooOpening): RawJob | null {
  if (!o.id || !o.jobOpeningName) return null;
  const url = `https://${s.site}.bamboohr.com/careers/${o.id}`;
  return {
    source: "schoolats",
    sourceJobId: `${s.site}:${o.id}`,
    title: o.jobOpeningName.trim(),
    url,
    schoolName: s.school,
    country: s.country,
    city: o.location?.city || undefined,
    contractTerm: o.employmentStatusLabel || undefined,
    applicationUrl: url,
    raw: o,
  };
}

export function fromRecruitee(s: AtsSite, o: RecruiteeOffer): RawJob | null {
  if (!o.id || !o.title || !o.careers_url) return null;
  const body = [o.description, o.requirements].filter(Boolean).join("\n");
  return {
    source: "schoolats",
    sourceJobId: `${s.site}:${o.id}`,
    title: o.title.trim(),
    url: o.careers_url,
    // A group lists every school under one site; the department is the school.
    schoolName: o.department?.trim() || s.school,
    country: o.country || s.country,
    city: o.city || undefined,
    postedAt: o.created_at ? new Date(o.created_at).toISOString() : undefined,
    deadlineAt: o.close_at || undefined,
    description: body ? htmlToText(body).slice(0, 8000) : undefined,
    applicationUrl: o.careers_url,
    raw: { ...o, description: undefined, requirements: undefined },
  };
}

async function collect(ctx: ScrapeContext): Promise<RawJob[]> {
  const jobs: RawJob[] = [];
  for (const s of SITES) {
    const opts = { soft: true, fresh: ctx.fresh, retries: 1, timeoutMs: 20000, label: `${s.system} ${s.site}` };
    if (s.system === "bamboohr") {
      const res = await fetchJson<{ result?: BambooOpening[] }>(`https://${s.site}.bamboohr.com/careers/list`, opts);
      for (const o of res?.result ?? []) {
        const job = fromBamboo(s, o);
        if (job) jobs.push(job);
      }
    } else {
      const res = await fetchJson<{ offers?: RecruiteeOffer[] }>(`https://${s.site}.recruitee.com/api/offers/`, opts);
      for (const o of res?.offers ?? []) {
        const job = fromRecruitee(s, o);
        if (job) jobs.push(job);
      }
    }
    if (ctx.maxJobs && jobs.length >= ctx.maxJobs) break;
  }
  log.debug(`School hiring sites: ${jobs.length} vacancies across ${SITES.length} sites`);
  return ctx.maxJobs ? jobs.slice(0, ctx.maxJobs) : jobs;
}

export const schoolAtsSource: Source = {
  id: "schoolats",
  label: "School hiring sites",
  note: "schools' own BambooHR and Recruitee job lists (public JSON); school named",
  collect,
};
