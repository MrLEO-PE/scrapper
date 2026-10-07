/**
 * WISHlistjobs (wishlistjobs.com) — its Physical Education listing.
 *
 * robots.txt allows everything, and the subject page answers with plain JSON:
 * fifteen posts a page, four pages. Each post names the school, the city, the
 * country, when it went up, and the roles it covers.
 *
 * What it does not give is the advert. A post's details sit behind a login (the
 * site itself answers 403 "log in required"), so they are not read: no
 * description, no application address. A post links back to the listing it
 * appears in, where the reader can open it. That is a thin record by design —
 * it names the school and the role early, which is the point of reading it.
 *
 * A post covers several roles at once ("Biology Teacher, Music Tutor, PE
 * Teacher - Cover"), and role titles contain commas of their own ("HEAD OF
 * DEPARTMENT, PHYSICAL EDUCATION & HEALTH"), so the PE role is found by
 * testing each piece and each adjacent pair rather than splitting blindly.
 */

import { fetchJson } from "../core/http.ts";
import { log } from "../core/logger.ts";
import { toIso } from "../core/text.ts";
import type { RawJob } from "../core/types.ts";
import { classify } from "../match/classify.ts";
import type { ScrapeContext, Source } from "./base.ts";

const ORIGIN = "https://www.wishlistjobs.com";
const LISTING = `${ORIGIN}/teach-physical-education-abroad`;
const MAX_PAGES = 12;

export interface WishlistPost {
  id: number;
  formatted_date_posted?: string;
  city_province?: string;
  country?: string;
  school_name?: string;
  school_year?: string;
  compensation?: string;
  closing_date?: string;
  vacancies_concat?: string;
}

interface Page {
  jobPosts?: WishlistPost[];
  currentPage?: number;
  totalPages?: number;
}

/** A leadership title with its subject still to come: "Head of Department". */
const STEM =
  /^(?:assistant\s+|deputy\s+|associate\s+)?(?:head|director|coordinator|co-ordinator|leader|lead|manager)\b(?:(?!teacher|tutor|coach|assistant\b)[^,])*\b(?:of|department|dept|faculty|subject)\s*$/i;

/**
 * The PE role inside a post's list of roles, exactly as written, or null.
 * Tries each piece alone first, then each adjacent pair, so a title that
 * itself contains a comma stays whole.
 */
export function peRole(roles: string | undefined): string | null {
  const text = (roles ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const parts = text.split(/\s*,\s*/).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    // "HEAD OF DEPARTMENT, PHYSICAL EDUCATION" is one role split by its own
    // comma. A piece that is only a leadership stem ends the title, not the
    // role, so it joins the piece after it — otherwise the leadership is lost.
    if (STEM.test(parts[i]!) && parts[i + 1]) {
      const joined = `${parts[i]}, ${parts[i + 1]}`;
      if (classify(joined).isPe) return joined;
    }
    if (classify(parts[i]!).isPe) return parts[i]!;
  }
  return classify(text).isPe ? text : null;
}

export function toRawJob(p: WishlistPost): RawJob | null {
  const title = peRole(p.vacancies_concat);
  if (!title) return null;

  const others = (p.vacancies_concat ?? "").replace(title, "").replace(/^[\s,]+|[\s,]+$/g, "");
  const closing = (p.closing_date ?? "").trim();

  return {
    source: "wishlist",
    sourceJobId: String(p.id),
    title,
    url: `${LISTING}#job-post-${p.id}`,
    schoolName: p.school_name?.trim() || undefined,
    city: p.city_province?.trim() || undefined,
    // The site files Hong Kong and Macau under "China", which would send
    // Kellett and Han Academy to the wrong country list — every other board
    // here, and the school directory, keep them separate.
    country: /^(hong\s*kong|macau|macao)$/i.test((p.city_province ?? "").trim())
      ? p.city_province!.trim()
      : p.country?.trim() || undefined,
    postedAt: toIso(p.formatted_date_posted),
    // "Until Filled" is not a date, and is not invented into one.
    deadlineAt: /^\d{4}-\d{2}-\d{2}/.test(closing) ? toIso(closing) : undefined,
    description: [
      p.school_year ? `School year ${p.school_year}.` : "",
      p.compensation && p.compensation !== "TBD" ? `Compensation: ${p.compensation}.` : "",
      others ? `Also advertised in this post: ${others}.` : "",
    ]
      .filter(Boolean)
      .join(" "),
    raw: p,
  };
}

export const wishlistSource: Source = {
  id: "wishlist",
  label: "WISHlistjobs",
  note: "Public JSON behind the Physical Education listing. Posts only — the advert is behind a login and is not read.",

  async collect(ctx: ScrapeContext): Promise<RawJob[]> {
    const posts = new Map<number, WishlistPost>();
    let totalPages = 1;

    for (let page = 1; page <= Math.min(totalPages, MAX_PAGES); page++) {
      const res = await fetchJson<Page>(`${LISTING}?page=${page}`, {
        fresh: ctx.fresh,
        soft: true,
        label: `wishlist p${page}`,
      });
      if (!res?.jobPosts) break;
      totalPages = res.totalPages ?? totalPages;
      for (const p of res.jobPosts) posts.set(p.id, p);
      if (ctx.maxJobs && posts.size >= ctx.maxJobs) break;
    }

    const jobs = [...posts.values()].map(toRawJob).filter((j): j is RawJob => !!j);
    log.info(`wishlist: ${posts.size} posts over ${totalPages} pages, ${jobs.length} with a PE role`);
    return jobs;
  },
};
