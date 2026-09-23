/**
 * Builds a SchoolProfile by combining what the job boards already told us with
 * what the school's own website says.
 *
 * Board data is trusted first (it is structured and maintained by the school),
 * and the crawl fills the gaps — student numbers, PE team size and, above all,
 * the careers email.
 */

import { fetchBuffer } from "../core/http.ts";
import { log } from "../core/logger.ts";
import { countryName } from "../core/text.ts";
import type {
  DiscoveredEmail,
  Salary,
  SchoolPhase,
  SchoolProfile,
  Sourced,
} from "../core/types.ts";
import { bestCareerEmail, bestSchoolEmail, domainOf, extractEmails, mergeEmails } from "./email.ts";
import {
  extractCurriculum,
  extractPackage,
  extractPeTeamSize,
  extractPhase,
  extractStudentCount,
} from "./facts.ts";
import { pdfToText } from "./pdf.ts";
import { crawlSchoolSite } from "./website.ts";

/** One school's worth of vacancy data, as gathered from the boards. */
export interface SchoolInput {
  schoolKey: string;
  schoolName: string;
  country?: string;
  city?: string;
  website?: string;
  /** Text of every vacancy this school posted — a rich source of package info. */
  jobTexts: string[];
  jobTitles: string[];
  emails: string[];
  curriculum: string[];
  gradeLevels: string[];
  benefits: string[];
  salaries: Salary[];
  /** Job packs / prospectuses attached to this school's adverts. */
  attachments: string[];
  sourceLabel: string;
}

const sourced = <T>(value: T, source: string, confidence: number, evidence?: string): Sourced<T> => ({
  value,
  provenance: { confidence, source, ...(evidence ? { evidence } : {}) },
});

/** Map grade-level names onto the Primary / Secondary / University column. */
function phaseFromGrades(grades: string[]): SchoolPhase | null {
  if (!grades.length) return null;
  const text = grades.join(" ").toLowerCase();
  const primary = /pre\s*school|kindergarten|nursery|reception|elementary|gr\.?\s*[1-5]\b|year\s*[1-6]\b|primary/.test(text);
  const secondary = /gr\.?\s*(?:[6-9]|1[0-2])\b|year\s*(?:[7-9]|1[0-3])\b|secondary|high\s*school|middle\s*school|sixth\s*form/.test(text);
  const university = /universit|undergraduate|tertiary/.test(text);
  if (university && !primary && !secondary) return "university";
  if (primary && secondary) return "k12";
  if (secondary) return "secondary";
  if (primary) return "primary";
  return null;
}

/**
 * A representative salary for an expat PE teacher at this school. Prefers an
 * explicit range from a PE vacancy; several postings are averaged so one
 * outlier does not define the number.
 */
function estimateSalary(salaries: Salary[]): Sourced<Salary> | null {
  const usable = salaries.filter((s) => s && (s.min != null || s.max != null));
  if (!usable.length) {
    const withText = salaries.find((s) => s?.text);
    return withText
      ? sourced(withText, "job advert (text only)", 0.45, withText.text)
      : null;
  }

  // Group by currency+period so we never average AED/month against GBP/year.
  const groups = new Map<string, Salary[]>();
  for (const s of usable) {
    const key = `${s.currency ?? "?"}|${s.period ?? "?"}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const [, best] = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0]!;

  const mins = best.map((s) => s.min).filter((n): n is number => n != null);
  const maxs = best.map((s) => s.max).filter((n): n is number => n != null);
  const avg = (ns: number[]) => Math.round(ns.reduce((a, b) => a + b, 0) / ns.length);

  const result: Salary = {
    currency: best[0]!.currency,
    period: best[0]!.period,
  };
  if (mins.length) result.min = avg(mins);
  if (maxs.length) result.max = avg(maxs);

  return sourced(
    result,
    `${best.length} advert${best.length > 1 ? "s" : ""} from this school`,
    best.length > 1 ? 0.75 : 0.6,
  );
}

export interface EnrichOptions {
  /** Skip the website crawl — board data only. Fast. */
  noCrawl?: boolean;
  maxPages?: number;
  maxPdfs?: number;
  fresh?: boolean;
  /** Wall-clock budget per school website, in ms. */
  budgetMs?: number;
}

export async function enrichSchool(input: SchoolInput, opts: EnrichOptions = {}): Promise<SchoolProfile> {
  const notes: string[] = [];
  const jobCorpus = input.jobTexts.join("\n\n");

  const profile: SchoolProfile = {
    schoolKey: input.schoolKey,
    schoolName: input.schoolName,
    enrichedAt: new Date().toISOString(),
    notes,
  };

  if (input.country) profile.country = sourced(countryName(input.country)!, input.sourceLabel, 0.9);
  if (input.city) profile.city = sourced(input.city, input.sourceLabel, 0.85);
  if (input.website) profile.website = sourced(input.website, input.sourceLabel, 0.9);

  // ---- from board data -------------------------------------------------
  if (input.curriculum.length) {
    const named = input.curriculum.filter((c) => c && !/^other$/i.test(c));
    if (named.length) profile.curriculum = sourced(named, input.sourceLabel, 0.85);
  }
  const gradePhase = phaseFromGrades(input.gradeLevels);
  if (gradePhase) profile.schoolType = sourced(gradePhase, `${input.sourceLabel} grade levels`, 0.85);

  const salary = estimateSalary(input.salaries);
  if (salary) profile.salaryEstimate = salary;

  if (input.benefits.length) {
    profile.packageNotes = sourced(input.benefits, `${input.sourceLabel} benefits`, 0.9);
  }

  // Addresses the board itself publishes as the application contact. These are
  // authoritative even when the local part is a person's name rather than
  // "recruitment@" — the school nominated them as where applications go — so
  // they are promoted to `careers` rather than merely scored up.
  let emails: DiscoveredEmail[] = extractEmails(input.emails.join(" "), input.sourceLabel, "source").map(
    (e) => ({
      ...e,
      kind: e.kind === "other" || e.kind === "info" || e.kind === "admin" ? "careers" : e.kind,
      score: Math.max(e.score, 0.9),
    }),
  );

  // Vacancy text often names the address to apply to.
  emails = mergeEmails(emails, extractEmails(jobCorpus, "job advert", "html"));

  // ---- job packs attached to the advert --------------------------------
  // These are the single best source for a careers address: a school that
  // attaches a job description almost always prints where to send it.
  let packText = "";
  const packs = [...new Set(input.attachments)].slice(0, opts.maxPdfs ?? 3);
  for (const url of packs) {
    const buf = await fetchBuffer(url, { soft: true, fresh: opts.fresh, retries: 1, timeoutMs: 30000 });
    if (!buf || buf.length > 25 * 1024 * 1024) continue;
    const text = pdfToText(buf);
    if (!text) continue;
    packText += "\n" + text;
    emails = mergeEmails(emails, extractEmails(text, url, "pdf"));
    log.debug(`${input.schoolName}: read job pack ${url} (${text.length} chars)`);
  }
  if (packs.length && !packText) notes.push(`${packs.length} attachment(s) had no readable text`);

  // ---- from the school's own website -----------------------------------
  const site = profile.website?.value;
  if (!site) {
    notes.push("no website known for this school — crawl skipped");
  } else if (opts.noCrawl) {
    notes.push("website crawl disabled (--no-crawl)");
  } else {
    try {
      const found = await crawlSchoolSite(site, {
        maxPages: opts.maxPages,
        maxPdfs: opts.maxPdfs,
        fresh: opts.fresh,
        budgetMs: opts.budgetMs,
        schoolName: input.schoolName,
      });
      if (!found) {
        notes.push(`could not read ${site}`);
      } else {
        log.debug(
          `${input.schoolName}: ${found.pagesVisited} pages, ${found.pdfsRead} PDFs, ${found.emails.length} emails`,
        );
        emails = mergeEmails(emails, found.emails);
        notes.push(...found.notes);

        if (found.principal) profile.principal = sourced(found.principal.text, found.principal.source, 0.8);
        if (found.schoolHook) profile.schoolHook = sourced(found.schoolHook.text, found.schoolHook.source, 0.8);
        if (found.peHook) profile.peHook = sourced(found.peHook.text, found.peHook.source, 0.8);

        if (found.careersPageUrl) {
          profile.careersPageUrl = sourced(found.careersPageUrl, site, 0.9);
        }
        if (found.studentCount) {
          profile.studentCount = sourced(
            found.studentCount.value, site, found.studentCount.confidence, found.studentCount.evidence,
          );
        }
        if (found.peTeamSize) {
          profile.peTeamSize = sourced(
            found.peTeamSize.value, site, found.peTeamSize.confidence, found.peTeamSize.evidence,
          );
        }
        if (!profile.curriculum && found.curriculum) {
          profile.curriculum = sourced(
            found.curriculum.value, site, found.curriculum.confidence, found.curriculum.evidence,
          );
        }
        if (!profile.schoolType && found.phase) {
          profile.schoolType = sourced(
            found.phase.value, site, found.phase.confidence, found.phase.evidence,
          );
        }
        if (found.packageNotes) {
          const merged = [...new Set([...(profile.packageNotes?.value ?? []), ...found.packageNotes.value])];
          profile.packageNotes = sourced(merged, profile.packageNotes ? `${input.sourceLabel} + ${site}` : site, 0.8, found.packageNotes.evidence);
        }
        if (found.pagesVisited === 0) notes.push(`website unreachable or blocked: ${site}`);
      }
    } catch (err) {
      notes.push(`crawl failed: ${(err as Error).message}`);
    }
  }

  // ---- fall back to the advert and its job packs for anything missing ---
  // Salary free-text is worth including: boards rarely publish a figure, but
  // the field routinely lists the package ("tax-free salary + housing
  // allowance + flights"), which is exactly what the Package column wants.
  const salaryText = input.salaries.map((s) => s.text ?? "").filter(Boolean).join("\n");
  const advertText = `${jobCorpus}\n${packText}\n${salaryText}`;
  if (!profile.curriculum) {
    const c = extractCurriculum(advertText);
    if (c) profile.curriculum = sourced(c.value, "job advert", c.confidence * 0.9, c.evidence);
  }
  if (!profile.schoolType) {
    const p = extractPhase(`${input.schoolName}\n${advertText}`);
    if (p) profile.schoolType = sourced(p.value, "job advert", p.confidence * 0.8, p.evidence);
  }
  if (!profile.packageNotes) {
    const pk = extractPackage(advertText);
    if (pk) profile.packageNotes = sourced(pk.value, "job advert", pk.confidence * 0.9, pk.evidence);
  }
  // Adverts and job packs routinely describe the school ("a co-educational
  // school of 1,300 students"), so they are worth mining when the website did
  // not say. Only explicit statements count for the PE team size — see
  // countPeStaff, which must not be run over advert text.
  if (!profile.studentCount && advertText.trim()) {
    const sc = extractStudentCount(advertText);
    if (sc) profile.studentCount = sourced(sc.value, "job advert", sc.confidence * 0.9, sc.evidence);
  }
  if (!profile.peTeamSize && advertText.trim()) {
    const pt = extractPeTeamSize(advertText);
    if (pt) profile.peTeamSize = sourced(pt.value, "job advert", pt.confidence, pt.evidence);
  }

  // ---- pick the two email columns --------------------------------------
  const domain = domainOf(site);
  profile.allEmails = emails.sort((a, b) => b.score - a.score).slice(0, 25);

  const career = bestCareerEmail(profile.allEmails, domain);
  if (career) {
    profile.careerEmail = sourced(career.email, career.foundAt, career.score, `via ${career.via}, ${career.kind}`);
  } else {
    notes.push("no careers/HR address found — check the school's contact page");
  }

  const general = bestSchoolEmail(
    profile.allEmails.filter((e) => e.email !== career?.email),
    domain,
  );
  if (general) {
    profile.schoolEmail = sourced(general.email, general.foundAt, general.score, `via ${general.via}, ${general.kind}`);
  }

  return profile;
}
