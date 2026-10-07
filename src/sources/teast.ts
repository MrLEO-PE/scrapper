/**
 * Teast (teast.co) — its PE & sports jobs, country by country.
 *
 * Teast is a young board for teaching jobs in Asia. robots.txt allows
 * everything, and each country page (`/jobs/thailand/pe-sports`) is rendered
 * on the server with the jobs embedded as structured data, including the
 * thing most boards withhold: the address the school wants applications sent
 * to, published in the advert itself, and an expiry date.
 *
 * The limit, stated plainly: the server renders only the newest two or three
 * jobs per country. The full list is loaded in the browser straight from the
 * site's own database using keys in its page code, and this reader does not
 * do that — it would be calling someone's database with credentials taken
 * from their source. The sitemap lists no job pages either. So this source
 * sees a recent slice per country, not everything, and treats absence as
 * meaning nothing (it is not swept for vanished roles).
 *
 * Teast also carries sports clubs, tutoring agencies and recruiters alongside
 * schools. They are not filtered out here; the employer name is the reader's
 * clue, and a role must still classify as PE.
 */

import { fetchText } from "../core/http.ts";
import { log } from "../core/logger.ts";
import { htmlToText, toIso } from "../core/text.ts";
import type { RawJob, Salary } from "../core/types.ts";
import { classify } from "../match/classify.ts";
import { siteFromEmail } from "../enrich/findsite.ts";
import type { ScrapeContext, Source } from "./base.ts";

const ORIGIN = "https://teast.co";

export interface TeastJob {
  title?: string;
  jobTitle?: string;
  companyName?: string;
  city?: string;
  country?: string;
  url?: string;
  slug?: string;
  createdAt?: number;
  endJobBy?: number;
  payString?: string;
  payMin?: number;
  payMax?: number;
  currency?: string;
  type?: string;
  employmentType?: string;
  applyType?: string;
  applyLink?: string;
  website?: string;
  jobDescription?: string;
  description?: string;
  status?: string;
  active?: boolean;
}

interface Location {
  name: string;
  path: string;
  type: string;
}

interface PageProps {
  jobs?: TeastJob[];
  locations?: Location[];
}

/** The data Next.js embeds in every page. */
export function pagePropsOf(html: string): PageProps | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m?.[1]) return null;
  try {
    return (JSON.parse(m[1]) as { props?: { pageProps?: PageProps } }).props?.pageProps ?? null;
  } catch {
    return null;
  }
}

const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function salaryOf(j: TeastJob): Salary | undefined {
  const s: Salary = {};
  if (j.payMin) s.min = j.payMin;
  if (j.payMax) s.max = j.payMax;
  if (j.currency) s.currency = j.currency;
  if (/month/i.test(j.type ?? "")) s.period = "MONTHLY";
  else if (/year|annum/i.test(j.type ?? "")) s.period = "ANNUAL";
  if (j.payString) s.text = j.payString;
  return s.min || s.max || s.text ? s : undefined;
}

export function toRawJob(j: TeastJob): RawJob | null {
  const title = (j.title || j.jobTitle || "").trim();
  const id = j.slug || j.url?.split("/").pop();
  if (!title || !id) return null;
  if (j.active === false || (j.status && j.status !== "active")) return null;

  const advert = htmlToText(j.jobDescription || j.description || "");
  if (!classify(title, advert).isPe) return null;

  const link = (j.applyLink ?? "").trim();
  // An address at the school's own domain is the school's. A free mailbox or an
  // applicant-tracking host is a recruiter or a system, so it is shown to the
  // reader but never treated as the school's careers address.
  const schoolOwn = EMAIL.test(link) && siteFromEmail(link) !== null;
  const description = EMAIL.test(link) && !schoolOwn ? `${advert}\n\nApply to: ${link}` : advert;
  return {
    source: "teast",
    sourceJobId: id,
    title,
    url: j.url || `${ORIGIN}/job/${id}`,
    schoolName: j.companyName?.trim() || undefined,
    city: j.city?.trim() || undefined,
    country: j.country?.trim() || undefined,
    description,
    postedAt: toIso(j.createdAt),
    // The expiry Teast itself sets on the advert — a real date, not a guess.
    deadlineAt: toIso(j.endJobBy),
    salary: salaryOf(j),
    contractType: j.employmentType,
    schoolWebsite: j.website?.trim() || undefined,
    // The address is the one the school published in the advert for applications.
    schoolEmails: schoolOwn ? [link.toLowerCase()] : undefined,
    applicationUrl: /^https?:\/\//i.test(link) ? link : undefined,
    raw: j,
  };
}

export const teastSource: Source = {
  id: "teast",
  label: "Teast",
  note: "PE & sports page of each country, server-rendered: the newest few per country, with application email and expiry date. Not the full list.",

  async collect(ctx: ScrapeContext): Promise<RawJob[]> {
    // One page tells us every country the board covers, so there is no list
    // of countries to keep in step with it.
    const seed = await fetchText(`${ORIGIN}/jobs/thailand/pe-sports`, { fresh: ctx.fresh, soft: true, label: "teast seed" });
    const seedProps = seed ? pagePropsOf(seed) : null;
    const countries = (seedProps?.locations ?? []).filter((l) => l.type === "country" && l.path && !/^online$/i.test(l.name));
    if (!countries.length) {
      log.warn("teast: could not read the list of countries");
      return [];
    }

    const out = new Map<string, RawJob>();
    for (const c of countries) {
      const html = c.path === "thailand" ? seed : await fetchText(`${ORIGIN}/jobs/${c.path}/pe-sports`, {
        fresh: ctx.fresh,
        soft: true,
        label: `teast ${c.path}`,
      });
      const jobs = html ? pagePropsOf(html)?.jobs ?? [] : [];
      for (const j of jobs) {
        const raw = toRawJob({ country: c.name, ...j });
        if (raw && !out.has(raw.sourceJobId)) out.set(raw.sourceJobId, raw);
      }
      if (ctx.maxJobs && out.size >= ctx.maxJobs) break;
    }

    log.info(`teast: ${out.size} PE roles across ${countries.length} countries`);
    return [...out.values()];
  },
};
