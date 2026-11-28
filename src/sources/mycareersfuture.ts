/**
 * MyCareersFuture, Singapore's national jobs portal (www.mycareersfuture.gov.sg).
 *
 * Before a Singapore employer can sponsor an Employment Pass, the Fair
 * Consideration Framework makes it advertise the post here, with a salary
 * range. International schools that hire from abroad therefore post here,
 * including some that no board carries and whose own sites refuse crawlers
 * (Dulwich College Singapore). Every post names its employer and gives a real
 * monthly salary range.
 *
 * The page calls a public JSON API on its own host, which has no robots.txt
 * rules against it:
 *
 *   GET api.mycareersfuture.gov.sg/v2/jobs?search=…&categories=Education%20and%20Training&limit=100&page=N
 *
 * The education category still carries swim schools, football academies and
 * tuition centres, so only employers whose Singapore industry code (SSIC) is a
 * school are kept: 851 pre-primary, 852 primary and secondary (85230 is
 * "international schools"), 853 post-secondary. Some schools carry no code, or
 * a general 85 one (German European School is 85499); those are kept when the
 * name says school or college and nothing says swim school or sports club.
 */

import { fetchJson } from "../core/http.ts";
import { htmlToText } from "../core/text.ts";
import type { RawJob, Salary } from "../core/types.ts";
import type { ScrapeContext, Source } from "./base.ts";

const API = "https://api.mycareersfuture.gov.sg/v2/jobs";
/** The PE classifier filters afterwards; these only have to catch every PE-linked post. */
const SEARCHES = ["physical education", "PE", "PHE", "sport", "sports", "athletics", "aquatics", "swimming", "coach", "co-curricular"];
const MAX_PAGES = 10;

interface Company {
  name?: string;
  ssicCode?: string;
  companyUrl?: string;
}

export interface McfJob {
  uuid: string;
  title: string;
  description?: string;
  postedCompany?: Company | null;
  hiringCompany?: Company | null;
  salary?: { minimum?: number; maximum?: number; type?: { salaryType?: string } } | null;
  employmentTypes?: { employmentType?: string }[];
  metadata?: { newPostingDate?: string; expiryDate?: string; jobDetailsUrl?: string; isHideSalary?: boolean };
}

export function isSchool(c?: Company | null): boolean {
  if (!c?.name) return false;
  if (/^85[123]/.test(c.ssicCode ?? "")) return true;
  if (c.ssicCode && !c.ssicCode.startsWith("85")) return false;
  return /\b(?:school|college)\b/i.test(c.name) && !/\b(?:swim\w*|football|soccer|gym\w*|sports?|tuition|music|dance)\b/i.test(c.name);
}

/**
 * "DULWICH COLLEGE (SINGAPORE) PTE. LTD." -> "Dulwich College (Singapore)".
 * shortcut: words of four letters or fewer stay upper case (XCL, HFSE, ICS), so
 * a short real word in an all-capitals name stays shouting; fine for matching.
 */
export function tidyName(name: string): string {
  const bare = name.replace(/\s*(?:\(PTE\.?\)|PTE\.?|PRIVATE)?\s*(?:LTD\.?|LIMITED)\s*$/i, "").trim();
  if (bare !== bare.toUpperCase()) return bare;
  const lower = new Set(["OF", "AND", "FOR"]);
  const word = new Set(["THE", "ONE", "NEW", "HIGH", "EAST", "WEST", "PARK", "HILL", "KIDS"]);
  return bare.replace(/[A-Z]+/g, (w) =>
    lower.has(w) ? w.toLowerCase() : w.length <= 4 && !word.has(w) ? w : w[0] + w.slice(1).toLowerCase());
}

const PERIOD: Record<string, string> = { Monthly: "MONTHLY", Annually: "ANNUAL", Annual: "ANNUAL", Hourly: "HOURLY", Daily: "DAILY", Weekly: "WEEKLY" };

export function toRawJob(j: McfJob): RawJob | null {
  // An agency posting for a school names the school as the hiring company.
  const employer = isSchool(j.hiringCompany) ? j.hiringCompany : isSchool(j.postedCompany) ? j.postedCompany : null;
  const url = j.metadata?.jobDetailsUrl;
  if (!j.uuid || !j.title || !url || !employer?.name) return null;
  const s = j.salary;
  const salary: Salary | undefined = s?.minimum && !j.metadata?.isHideSalary
    ? { min: s.minimum, max: s.maximum, currency: "SGD", period: PERIOD[s.type?.salaryType ?? ""] }
    : undefined;
  return {
    source: "mycareersfuture",
    sourceJobId: j.uuid,
    title: j.title.trim(),
    url,
    schoolName: tidyName(employer.name),
    country: "Singapore",
    city: "Singapore",
    description: j.description ? htmlToText(j.description).slice(0, 8000) : undefined,
    postedAt: j.metadata?.newPostingDate,
    deadlineAt: j.metadata?.expiryDate,
    salary,
    contractType: j.employmentTypes?.map((e) => e.employmentType).filter(Boolean).join(", ") || undefined,
    schoolWebsite: employer.companyUrl || undefined,
    applicationUrl: url,
    raw: { uuid: j.uuid, employer: employer.name, ssic: employer.ssicCode },
  };
}

async function collect(ctx: ScrapeContext): Promise<RawJob[]> {
  const jobs = new Map<string, RawJob>();
  for (const q of SEARCHES) {
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await fetchJson<{ results?: McfJob[]; total?: number }>(
        `${API}?search=${encodeURIComponent(q)}&categories=${encodeURIComponent("Education and Training")}&limit=100&page=${page}`,
        { soft: true, fresh: ctx.fresh, retries: 1, timeoutMs: 25000, label: `mycareersfuture "${q}" p${page}` },
      );
      for (const j of res?.results ?? []) {
        const job = toRawJob(j);
        if (job) jobs.set(job.sourceJobId, job);
      }
      if (!res?.results?.length || (page + 1) * 100 >= (res.total ?? 0)) break;
    }
    if (ctx.maxJobs && jobs.size >= ctx.maxJobs) break;
  }
  const out = [...jobs.values()];
  return ctx.maxJobs ? out.slice(0, ctx.maxJobs) : out;
}

export const myCareersFutureSource: Source = {
  id: "mycareersfuture",
  label: "MyCareersFuture (Singapore)",
  note: "Singapore's government jobs portal, public JSON; schools only (by industry code); salary range on every post",
  collect,
};
