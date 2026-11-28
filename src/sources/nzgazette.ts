/**
 * Education Gazette, New Zealand's official vacancy board (gazette.education.govt.nz).
 *
 * Every state and state-integrated school in New Zealand advertises here, so
 * it is the whole NZ market in one place, Heads of Health and PE and
 * Directors of Sport included. robots.txt allows everything.
 *
 * The search page is server-rendered (`/vacancies?q=…&page=N`, 20 a page)
 * and each vacancy page carries a schema.org JobPosting with the full advert,
 * the school, the region and exact posted and closing times, so nothing has
 * to be inferred from the listing's year-less dates.
 */

import { fetchText } from "../core/http.ts";
import { htmlToText, toIso } from "../core/text.ts";
import type { RawJob } from "../core/types.ts";
import type { ScrapeContext, Source } from "./base.ts";

const ORIGIN = "https://gazette.education.govt.nz";
/** Full-text searches; "PE" alone matches nearly every post, so it is not one. */
const SEARCHES = ["physical education", "health and physical", "sport", "outdoor education", "athletics"];
const MAX_PAGES = 8;

/** The vacancy references on a search page. */
export function refsFrom(html: string): string[] {
  return [...new Set([...html.matchAll(/data-reference="(\w+)"/g)].map((m) => m[1]!))];
}

export function fromJobPosting(html: string, ref: string): RawJob | null {
  for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    let o: any;
    try {
      o = JSON.parse(m[1]!);
    } catch {
      continue;
    }
    if (o?.["@type"] !== "JobPosting" || !o.title || !o.hiringOrganization?.name) continue;
    const addr = o.jobLocation?.address ?? {};
    const url = String(o.url ?? `${ORIGIN}/vacancies/${ref}`);
    return {
      source: "nzgazette",
      sourceJobId: ref,
      title: String(o.title).trim(),
      url,
      schoolName: String(o.hiringOrganization.name).trim(),
      country: "New Zealand",
      city: addr.addressRegion || undefined,
      description: o.description ? htmlToText(String(o.description)).slice(0, 8000) : undefined,
      postedAt: toIso(o.datePosted),
      deadlineAt: toIso(o.validThrough),
      contractType: Array.isArray(o.employmentType) ? o.employmentType.join(", ") : o.employmentType,
      applicationUrl: url,
      raw: { ref, region: addr.addressRegion, street: addr.streetAddress },
    };
  }
  return null;
}

async function collect(ctx: ScrapeContext): Promise<RawJob[]> {
  const opts = { soft: true, fresh: ctx.fresh, retries: 1, timeoutMs: 20000 };
  const refs = new Set<string>();
  for (const q of SEARCHES) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const html = await fetchText(`${ORIGIN}/vacancies?q=${encodeURIComponent(q)}${page > 1 ? `&page=${page}` : ""}`, { ...opts, label: `nzgazette "${q}" p${page}` });
      const found = html ? refsFrom(html) : [];
      const before = refs.size;
      found.forEach((r) => refs.add(r));
      // A short page is the last one; a page with nothing new means paging wrapped.
      if (found.length < 20 || refs.size === before) break;
    }
  }

  const jobs: RawJob[] = [];
  for (const ref of refs) {
    if (ctx.maxJobs && jobs.length >= ctx.maxJobs) break;
    const html = await fetchText(`${ORIGIN}/vacancies/${ref}`, { ...opts, label: `nzgazette ${ref}` });
    const job = html ? fromJobPosting(html, ref) : null;
    if (job) jobs.push(job);
  }
  return jobs;
}

export const nzGazetteSource: Source = {
  id: "nzgazette",
  label: "Education Gazette (New Zealand)",
  note: "NZ's official school vacancy board; keyword searches, then each vacancy's schema.org JobPosting; school named",
  collect,
};
