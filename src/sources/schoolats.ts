/**
 * Schools' own hiring sites on BambooHR, Recruitee, Teamtailor, Lever and Workable.
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
 *   Teamtailor {careers host}/jobs.rss  (every opening, with location and campus)
 *   Lever      https://api.lever.co/v0/postings/{site}?mode=json
 *   Workable   https://apply.workable.com/api/v1/widget/accounts/{site}?details=true
 *              (the public jobs widget an employer embeds on its own site)
 *
 * Each site below is a school or school group found by that scan. Add one by
 * its subdomain; the country is the school's, since BambooHR's own location
 * field is often blank.
 */

import { fetchJson, fetchText } from "../core/http.ts";
import { log } from "../core/logger.ts";
import { decodeEntities, htmlToText } from "../core/text.ts";
import type { RawJob } from "../core/types.ts";
import type { ScrapeContext, Source } from "./base.ts";

export interface AtsSite {
  system: "bamboohr" | "recruitee" | "teamtailor" | "lever" | "workable";
  /** The subdomain; for Teamtailor, the careers host itself. */
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
  { system: "teamtailor", site: "careers.etonhouse.edu.sg", school: "EtonHouse" },
  { system: "teamtailor", site: "careers.vas.edu.vn", school: "Vietnam Australia International School", country: "Vietnam" },
  { system: "lever", site: "gess", school: "German European School Singapore", country: "Singapore" },
  // A recruiter for schools in China (526 posts, ~20 PE, most with the salary stated); it does not name the school.
  { system: "workable", site: "elevate-7" },
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

/** The openings in a Teamtailor jobs.rss feed. */
export function fromTeamtailor(s: AtsSite, rss: string): RawJob[] {
  const out: RawJob[] = [];
  for (const item of rss.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
    const tag = (t: string) => item.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1]?.trim();
    const link = tag("link");
    const title = tag("title");
    const id = link?.match(/\/jobs\/(\d+)/)?.[1];
    if (!link || !title || !id) continue;
    const dept = tag("tt:department");
    const pub = tag("pubDate");
    const body = tag("description");
    out.push({
      source: "schoolats",
      sourceJobId: `${s.site}:${id}`,
      title: decodeEntities(title),
      url: link,
      schoolName: s.school && dept ? `${s.school} (${decodeEntities(dept)})` : s.school ?? dept,
      country: tag("tt:country") || s.country,
      city: tag("tt:city") || undefined,
      postedAt: pub ? new Date(pub).toISOString() : undefined,
      description: body ? htmlToText(decodeEntities(body)).slice(0, 8000) : undefined,
      applicationUrl: link,
      raw: { link, dept, role: tag("tt:role") },
    });
  }
  return out;
}

export interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  createdAt?: number;
  categories?: { location?: string; team?: string; commitment?: string };
  descriptionPlain?: string;
}

export function fromLever(s: AtsSite, o: LeverPosting): RawJob | null {
  if (!o.id || !o.text || !o.hostedUrl) return null;
  return {
    source: "schoolats",
    sourceJobId: `${s.site}:${o.id}`,
    title: o.text.trim(),
    url: o.hostedUrl,
    schoolName: s.school,
    country: s.country,
    city: o.categories?.location || undefined,
    contractTerm: o.categories?.commitment || undefined,
    postedAt: o.createdAt ? new Date(o.createdAt).toISOString() : undefined,
    description: o.descriptionPlain?.slice(0, 8000),
    applicationUrl: `${o.hostedUrl}/apply`,
    raw: { ...o, descriptionPlain: undefined },
  };
}

export interface WorkableJob {
  title: string;
  shortcode: string;
  url?: string;
  application_url?: string;
  published_on?: string;
  employment_type?: string;
  country?: string;
  city?: string;
  description?: string;
}

export function fromWorkable(s: AtsSite, o: WorkableJob): RawJob | null {
  if (!o.shortcode || !o.title) return null;
  const url = o.url || `https://apply.workable.com/${s.site}/j/${o.shortcode}/`;
  return {
    source: "schoolats",
    sourceJobId: `${s.site}:${o.shortcode}`,
    title: o.title.trim(),
    url,
    schoolName: s.school,
    country: o.country || s.country,
    city: o.city || undefined,
    contractType: o.employment_type || undefined,
    postedAt: o.published_on || undefined,
    description: o.description ? htmlToText(o.description).slice(0, 8000) : undefined,
    applicationUrl: o.application_url || url,
    raw: { ...o, description: undefined },
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
    } else if (s.system === "lever") {
      const res = await fetchJson<LeverPosting[]>(`https://api.lever.co/v0/postings/${s.site}?mode=json`, opts);
      for (const o of res ?? []) {
        const job = fromLever(s, o);
        if (job) jobs.push(job);
      }
    } else if (s.system === "workable") {
      const res = await fetchJson<{ jobs?: WorkableJob[] }>(`https://apply.workable.com/api/v1/widget/accounts/${s.site}?details=true`, opts);
      for (const o of res?.jobs ?? []) {
        const job = fromWorkable(s, o);
        if (job) jobs.push(job);
      }
    } else if (s.system === "teamtailor") {
      const rss = await fetchText(`https://${s.site}/jobs.rss`, opts);
      if (rss) jobs.push(...fromTeamtailor(s, rss));
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
  note: "schools' own BambooHR, Recruitee, Teamtailor, Lever and Workable job lists (public JSON/RSS)",
  collect,
};
