/**
 * The three stages, and the `run` that chains them.
 *
 *   scrape  — hit the boards, classify, store
 *   enrich  — build school profiles (website crawl, PDFs, emails)
 *   export  — write the ticked columns out for Google Sheets
 */

import { join } from "node:path";
import { OUT_DIR, loadFields, type Targets } from "./config.ts";
import { mapLimit, stats as httpStats } from "./core/http.ts";
import { log } from "./core/logger.ts";
import { dedupe, normalize } from "./core/normalize.ts";
import { hostOf, slugify } from "./core/text.ts";
import type { Job, Salary, SchoolProfile, SourceId } from "./core/types.ts";
import { bestCareerEmail, bestSchoolEmail, domainOf, extractEmails } from "./enrich/email.ts";
import { findWebsite } from "./enrich/findsite.ts";
import { saveWebsites, type WebsiteEntry } from "./enrich/websites.ts";
import { fetchCountryDirectory, phaseFromOrgType, type DirectorySchool } from "./directory.ts";
import { enrichSchool, type EnrichOptions, type SchoolInput } from "./enrich/school.ts";
import { selectedCountries } from "./locations.ts";
import {
  isTargetCountry,
  loadDirectoryTargets,
  plannedTotal,
  targetCountries,
  vacancyInScope,
  type DirectoryTarget,
} from "./directoryconfig.ts";
import { buildTable, writeCsv, writeHtml, writeJson, writeTsv, type SheetRow } from "./export/sheet.ts";
import { resetHiring } from "./export/fields.ts";
import { syncToSheet } from "./export/gsheets.ts";
import { buildSite } from "./export/site.ts";
import { tesSource } from "./sources/tes.ts";
import { teachawaySource } from "./sources/teachaway.ts";
import { teacherHorizonsSource } from "./sources/teacherhorizons.ts";
import { successFactorsSources } from "./sources/successfactors.ts";
import { workdaySources } from "./sources/workday.ts";
import { schoolSitesSource } from "./sources/schoolsites.ts";
import { mailboxSource } from "./sources/mailbox.ts";
import { europeanChamberSource } from "./sources/europeanchamber.ts";
import type { Source } from "./sources/base.ts";
import {
  expirePastDeadline,
  finishRun,
  getSchools,
  getSchoolsNeedingWebsite,
  parseJsonColumn,
  queryJobs,
  recordSightings,
  schoolsNeedingEnrichment,
  startRun,
  stats as dbStats,
  sweepMissing,
  upsertJobs,
  byCountryRank,
  rerankCountries,
  upsertSchool,
  type JobRow,
  type QueryOptions,
} from "./store/db.ts";

export const ALL_SOURCES: Source[] = [
  tesSource,
  teachawaySource,
  teacherHorizonsSource,
  ...successFactorsSources,
  ...workdaySources,
  schoolSitesSource,
  europeanChamberSource,
  mailboxSource,
];

/**
 * Sources that list their whole inventory each run. Only these can be used to
 * infer that a missing vacancy has been taken down — Teacher Horizons shows a
 * rolling window, so absence there means nothing.
 */
// Sources that list their full inventory each run, so a vacancy going missing
// is meaningful. Email alerts and school pages are not: an alert is a one-off
// message, and a school page shows only what is open today.
const ENUMERATED: SourceId[] = ["tes", "teachaway", "nordanglia", "inspired", "europeanchamber", "isp"];

export interface ScrapeOptions {
  sources?: string[];
  fresh?: boolean;
  deep?: boolean;
  maxJobs?: number;
  targets: Targets;
}

export interface ScrapeSummary {
  runId: number;
  bySource: Record<string, { raw: number; pe: number; failed?: string }>;
  inserted: number;
  updated: number;
  reopened: number;
  duplicates: number;
  stale: number;
  closed: number;
  expired: number;
}

export async function runScrape(opts: ScrapeOptions): Promise<ScrapeSummary> {
  const wanted = opts.sources?.length ? opts.sources : opts.targets.sources;
  const sources = ALL_SOURCES.filter((s) => wanted.includes(s.id));
  if (!sources.length) throw new Error(`no matching sources in: ${wanted.join(", ")}`);

  const runId = startRun("scrape");
  const ctx = { fresh: !!opts.fresh, deep: !!opts.deep, maxJobs: opts.maxJobs ?? 0 };
  const bySource: ScrapeSummary["bySource"] = {};
  const all: Job[] = [];

  for (const source of sources) {
    log.step(`${source.label}`);
    if (source.note) log.info(source.note);
    try {
      const raw = await source.collect(ctx);
      const jobs = raw.map((r) => normalize(r, { threshold: opts.targets.threshold }));
      const pe = jobs.filter((j) => j.pe.isPe).filter((j) => matchesTargets(j, opts.targets));
      bySource[source.id] = { raw: raw.length, pe: pe.length };
      log.ok(`${source.label}: ${pe.length} PE-linked of ${raw.length} scanned`);
      all.push(...pe);
    } catch (err) {
      const message = (err as Error).message;
      bySource[source.id] = { raw: 0, pe: 0, failed: message };
      log.error(`${source.label} failed: ${message}`);
    }
  }

  const { kept, duplicates } = dedupe(all);
  const { inserted, updated, reopened } = upsertJobs(kept, runId);

  // Every vacancy we actually saw counts as sighted, including the duplicates
  // dedupe discarded — those are still live on their own board.
  recordSightings(runId, all.map((j) => j.id));

  // Only sweep for disappeared vacancies when the enumerating sources actually
  // ran — otherwise a network failure would mark everything closed.
  const ranEnumerated = ENUMERATED.filter(
    (id) => sources.some((s) => s.id === id) && !bySource[id]?.failed,
  );
  const { stale, closed } = sweepMissing(runId, ranEnumerated);
  const expired = expirePastDeadline();

  const summary: ScrapeSummary = {
    runId, bySource, inserted, updated, reopened, duplicates, stale, closed, expired,
  };
  finishRun(runId, { ...summary, http: { ...httpStats } });
  return summary;
}

function matchesTargets(job: Job, t: Targets): boolean {
  if (t.seniority.length && !t.seniority.includes(job.pe.seniority)) return false;
  if (t.countries.length) {
    const hay = `${job.country ?? ""} ${job.city ?? ""}`.toLowerCase();
    if (!t.countries.some((c) => hay.includes(c.toLowerCase()))) return false;
  }
  if (t.cities.length) {
    const hay = `${job.city ?? ""} ${job.country ?? ""}`.toLowerCase();
    if (!t.cities.some((c) => hay.includes(c.toLowerCase()))) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------

export interface EnrichRunOptions extends EnrichOptions {
  /** Re-enrich schools older than this many days. */
  maxAgeDays?: number;
  limit?: number;
  concurrency?: number;
}

export async function runEnrich(opts: EnrichRunOptions = {}): Promise<{ enriched: number; withCareerEmail: number }> {
  const pending = schoolsNeedingEnrichment(opts.maxAgeDays ?? 30, opts.limit ?? 0);
  if (!pending.length) {
    log.info("every school is already enriched and fresh — nothing to do");
    return { enriched: 0, withCareerEmail: 0 };
  }

  log.step(`Enriching ${pending.length} schools`);
  // Group each school's vacancies so the profile sees all of its adverts.
  const jobsBySchool = new Map<string, JobRow[]>();
  for (const row of queryJobs({ peOnly: true, status: "any" })) {
    if (!row.school_key) continue;
    jobsBySchool.set(row.school_key, [...(jobsBySchool.get(row.school_key) ?? []), row]);
  }

  let withCareerEmail = 0;
  let done = 0;

  await mapLimit(pending, opts.concurrency ?? 4, async (school) => {
    const rows = jobsBySchool.get(school.school_key) ?? [];
    const input: SchoolInput = {
      schoolKey: school.school_key,
      schoolName: school.name || rows[0]?.school_name || school.school_key,
      country: school.country ?? rows[0]?.country ?? undefined,
      city: school.city ?? rows[0]?.city ?? undefined,
      website: school.website ?? rows.find((r) => r.school_website)?.school_website ?? undefined,
      jobTexts: rows.map((r) => r.description ?? "").filter(Boolean),
      jobTitles: rows.map((r) => r.title),
      emails: rows.flatMap((r) => parseJsonColumn<string[]>(r.emails_json, [])),
      curriculum: rows.flatMap((r) => parseJsonColumn<string[]>(r.curriculum_json, [])),
      gradeLevels: [],
      benefits: rows.flatMap((r) => parseJsonColumn<string[]>(r.benefits_json, [])),
      salaries: rows.map((r) => parseJsonColumn<Salary | null>(r.salary_json, null)).filter((s): s is Salary => !!s),
      // Attachments used to be stored as bare URLs and are now {url, caption};
      // accept either so an existing database keeps working.
      attachments: rows.flatMap((r) =>
        parseJsonColumn<(string | { url?: string })[]>(r.attachments_json, [])
          .map((a) => (typeof a === "string" ? a : a?.url))
          .filter((u): u is string => typeof u === "string" && u.length > 0),
      ),
      sourceLabel: rows[0]?.source ?? "job board",
    };

    try {
      const profile = await enrichSchool(input, opts);
      upsertSchool(profile, "job");
      if (profile.careerEmail) withCareerEmail++;
      done++;
      log.info(
        `[${done}/${pending.length}] ${input.schoolName} — ` +
          `${profile.careerEmail?.value ?? "no careers email"}` +
          `${profile.studentCount ? `, ${profile.studentCount.value} students` : ""}` +
          `${profile.peTeamSize ? `, PE team ~${profile.peTeamSize.value}` : ""}`,
      );
    } catch (err) {
      log.warn(`${input.schoolName}: ${(err as Error).message}`);
    }
  });

  // Enrichment is what turns an unranked school into a ranked one, so the
  // country lists are stale the moment it finishes. Re-ranking here means
  // nobody has to remember to do it.
  const reranked = rerankCountries();
  log.info(
    `re-ranked ${reranked.schools} schools — ${reranked.onSalary + reranked.onPackage} on ` +
      `package, ${reranked.onProxy} still awaiting a profile`,
  );

  return { enriched: done, withCareerEmail };
}

// ---------------------------------------------------------------------------

export interface DirectoryOptions extends EnrichOptions {
  /** Country names. Falls back to whatever is ticked in locations.json. */
  countries?: string[];
  cities?: string[];
  /** Schools per country to keep, by prominence. */
  top?: number;
  concurrency?: number;
  /** Collect and rank only — skip the per-school website crawl. */
  listOnly?: boolean;
}

/**
 * Turn the addresses a directory listing publishes into profile fields.
 *
 * `notifJobEmail` is where the school asked for job applications to be sent,
 * so it is a careers address by the school's own declaration — stronger
 * evidence than anything a crawl infers from a page. It is still run through
 * the classifier, which is what rejects a student careers adviser.
 */
function directoryEmails(s: DirectorySchool): {
  career?: string;
  profile: Partial<SchoolProfile>;
} {
  if (!s.emails.length) return { profile: {} };

  const found = extractEmails(s.emails.join(" "), "teachaway directory", "source").map((e) => ({
    ...e,
    kind: e.kind === "other" || e.kind === "info" || e.kind === "admin" ? ("careers" as const) : e.kind,
    score: Math.max(e.score, 0.9),
  }));
  if (!found.length) return { profile: {} };

  const domain = domainOf(s.website);
  const career = bestCareerEmail(found, domain);
  const general = bestSchoolEmail(found, domain);
  const src = { confidence: 0.9, source: "teachaway directory" };

  return {
    career: career?.email,
    profile: {
      allEmails: found,
      ...(career ? { careerEmail: { value: career.email, provenance: src } } : {}),
      ...(general ? { schoolEmail: { value: general.email, provenance: src } } : {}),
    },
  };
}

export interface DirectorySummary {
  countries: number;
  found: number;
  enriched: number;
  withCareerEmail: number;
  skipped: string[];
}

/**
 * Build a school directory for the ticked countries, regardless of whether the
 * schools are currently recruiting, and enrich each one into the sheet columns.
 */
export async function runDirectory(opts: DirectoryOptions = {}): Promise<DirectorySummary> {
  // Three ways to say what to collect, most explicit first: countries passed
  // on the command line, the directory's own quota list, or whatever is ticked
  // in locations.json.
  const configured = loadDirectoryTargets();
  const targets: DirectoryTarget[] = opts.countries?.length
    ? opts.countries.map((name) => ({ name, top: opts.top ?? 30, cities: opts.cities }))
    : configured.length
      ? configured.map((t) => ({ ...t, top: opts.top ?? t.top }))
      : selectedCountries().map((c) => ({ name: c.name, top: opts.top ?? 30 }));

  if (!targets.length) {
    log.warn("nothing to collect.");
    log.plain("  Set quotas in config/directory.json, or tick countries:");
    log.plain("    npm run locations -- --on AE,QA,SG");
    log.plain("  Or pass them:  npm run directory -- --countries \"Qatar,Oman\" --top 20");
    return { countries: 0, found: 0, enriched: 0, withCareerEmail: 0, skipped: [] };
  }

  log.step(
    `Directory — ${targets.length} countr${targets.length === 1 ? "y" : "ies"}, ` +
      `up to ${plannedTotal(targets)} schools`,
  );

  const runId = startRun("directory");
  const all: DirectorySchool[] = [];
  const skipped: string[] = [];

  for (const target of targets) {
    const schools = await fetchCountryDirectory(target.name, {
      fresh: opts.fresh,
      top: target.top,
      cities: target.cities ?? opts.cities,
      slug: target.slug,
    });
    // A country listing nothing is normal for the smaller places, not a fault.
    if (!schools.length) skipped.push(target.name);
    all.push(...schools);
  }

  const picked = targets.map((t) => t.name);

  log.ok(`${all.length} schools collected across ${picked.length - skipped.length} countries`);

  // Rank within each country so the sheet can show "3rd in Qatar".
  const rankByKey = new Map<string, number>();
  for (const country of picked) {
    const inCountry = all.filter((s) => s.country === country);
    inCountry.forEach((s, i) => rankByKey.set(s.schoolKey, i + 1));
  }

  if (opts.listOnly) {
    let listedEmails = 0;
    for (const s of all) {
      /*
       * The listing publishes the address the school nominated for job
       * notifications, and it was being thrown away.
       *
       * Listing collected these, stored none of them, and the enrichment batch
       * that runs afterwards reads from the database rather than the listing —
       * so a careers address the directory handed over on a plate never
       * reached the sheet. About one school in five has one, which against a
       * Career Email column sitting at 10% is not a rounding error.
       */
      const emails = directoryEmails(s);
      if (emails.career) listedEmails++;

      upsertSchool(
        {
          schoolKey: s.schoolKey,
          schoolName: s.name,
          country: { value: s.country, provenance: { confidence: 0.95, source: "teachaway directory" } },
          ...(s.city ? { city: { value: s.city, provenance: { confidence: 0.9, source: "teachaway directory" } } } : {}),
          ...(s.website ? { website: { value: s.website, provenance: { confidence: 0.95, source: "teachaway directory" } } } : {}),
          ...(s.accredBodies.length ? { accreditation: s.accredBodies.join(", ") } : {}),
          ...emails.profile,
          ...(s.phone ? { phone: { value: s.phone, provenance: { confidence: 0.9, source: "teachaway directory" } } } : {}),
          prominence: s.prominence,
          notes: s.why,
        },
        "directory",
        rankByKey.get(s.schoolKey),
        // Listing is not profiling. Leaving enriched_at unset is what lets a
        // later run pick these up — marking them done here would strand every
        // school with nothing but a name and a rank.
        false,
      );
    }
    if (listedEmails) log.ok(`${listedEmails} careers addresses taken straight from the listing`);

    // Listing refreshes each school's proxy score, so the order has to be
    // recomputed — schools already profiled keep their package-based place.
    const listRank = rerankCountries();
    log.ok(`ranked ${listRank.schools} schools across ${listRank.countries} countries`);

    finishRun(runId, { countries: picked.length, found: all.length, listOnly: true });
    return { countries: picked.length, found: all.length, enriched: 0, withCareerEmail: 0, skipped };
  }

  let withCareerEmail = 0;
  let done = 0;

  await mapLimit(all, opts.concurrency ?? 5, async (s) => {
    const input: SchoolInput = {
      schoolKey: s.schoolKey,
      schoolName: s.name,
      country: s.country,
      city: s.city,
      website: s.website,
      // No vacancy text in directory mode — the profile blurb is what we have.
      jobTexts: s.description ? [s.description] : [],
      jobTitles: [],
      emails: s.emails,
      curriculum: [],
      gradeLevels: [],
      benefits: [],
      salaries: [],
      attachments: [],
      sourceLabel: "teachaway directory",
    };

    try {
      const profile = await enrichSchool(input, opts);
      // Keep the directory's own signals alongside the crawl findings.
      if (!profile.schoolType) {
        const phase = phaseFromOrgType(s.orgType);
        if (phase) {
          profile.schoolType = { value: phase, provenance: { confidence: 0.8, source: "teachaway directory" } };
        }
      }
      profile.notes = [...(profile.notes ?? []), ...s.why];
      // Directory facts the crawl cannot establish, kept for the re-rank.
      if (s.accredBodies.length) profile.accreditation = s.accredBodies.join(", ");
      profile.prominence = s.prominence;
      if (s.phone) profile.phone = { value: s.phone, provenance: { confidence: 0.9, source: "teachaway directory" } };

      upsertSchool(profile, "directory", rankByKey.get(s.schoolKey));
      if (profile.careerEmail) withCareerEmail++;
      done++;
      log.info(
        `[${done}/${all.length}] ${s.country} #${rankByKey.get(s.schoolKey)} ${s.name} — ` +
          `${profile.careerEmail?.value ?? "no careers email"}` +
          `${profile.studentCount ? `, ${profile.studentCount.value} students` : ""}`,
      );
    } catch (err) {
      log.warn(`${s.name}: ${(err as Error).message}`);
    }
  });

  // Now that packages are known, re-rank each country on what a teacher would
  // actually get. Until this point the order is only the directory's proxy.
  const reranked = rerankCountries();
  log.ok(
    `ranked ${reranked.schools} schools across ${reranked.countries} countries — ` +
      `${reranked.onSalary} on package + salary, ${reranked.onPackage} on package, ` +
      `${reranked.onProxy} on accreditation only`,
  );

  finishRun(runId, { countries: picked.length, found: all.length, enriched: done });
  return { countries: picked.length, found: all.length, enriched: done, withCareerEmail, skipped };
}

// ---------------------------------------------------------------------------

export interface FindSitesOptions {
  limit?: number;
  concurrency?: number;
  /** Report what would be written without touching the file. */
  dryRun?: boolean;
}

export interface FindSitesSummary {
  considered: number;
  fromEmail: number;
  fromGuess: number;
  notFound: number;
}

/**
 * Fill in the missing school websites, which gate almost everything else.
 *
 * Results go to `config/school-websites.json` rather than straight into the
 * database, so every address is inspectable, editable and survives a rebuild —
 * and so a wrong one can be deleted by hand rather than hunted through a
 * binary file.
 */
export async function runFindSites(opts: FindSitesOptions = {}): Promise<FindSitesSummary> {
  const targets = targetCountries();
  const rows = getSchoolsNeedingWebsite(targets, opts.limit ?? 0);

  log.step(`Looking for ${rows.length} missing school websites`);
  const summary: FindSitesSummary = { considered: rows.length, fromEmail: 0, fromGuess: 0, notFound: 0 };
  const found: Record<string, WebsiteEntry> = {};
  const today = new Date().toISOString().slice(0, 10);

  // Each school is a different host, so these do not queue behind each other.
  await mapLimit(rows, opts.concurrency ?? 6, async (s) => {
    const hit = await findWebsite(s.name, s.country ?? "", s.career_email ?? s.school_email);
    if (!hit) {
      summary.notFound++;
      return;
    }
    if (hit.via === "email") summary.fromEmail++;
    else summary.fromGuess++;

    found[s.school_key] = {
      url: hit.url,
      via: hit.via === "email" ? "email domain" : "domain-guess, verified",
      found: today,
      note: `${s.name} — ${s.country ?? "?"}`,
    };
    log.info(`  ${hit.via === "email" ? "from email" : "verified  "}  ${s.name.slice(0, 38).padEnd(40)}${hit.url}`);
  });

  /*
   * A website belongs to one school.
   *
   * Five different "EF English First" branches all resolved to english.com,
   * which is Pearson Languages. Two "Ministry of Education" records landed on
   * ministry.com. Where several schools claim one host, the guess is telling
   * us the stem was too generic to identify anything — so none of them keeps
   * it. This mirrors the rule that stops a shared applicant-tracking domain
   * merging thirteen BASIS schools into one.
   */
  const byHost = new Map<string, string[]>();
  for (const [key, entry] of Object.entries(found)) {
    const host = hostOf(entry.url);
    if (host) byHost.set(host, [...(byHost.get(host) ?? []), key]);
  }
  for (const [host, keys] of byHost) {
    if (keys.length < 2) continue;
    for (const k of keys) delete found[k];
    summary.fromGuess -= keys.length;
    summary.notFound += keys.length;
    log.warn(`dropped ${host} — ${keys.length} different schools resolved to it, so it identifies none`);
  }

  if (!opts.dryRun && Object.keys(found).length) {
    const added = saveWebsites(found);
    log.ok(`${added} new entries written to config/school-websites.json`);
  }
  return summary;
}

export interface ExportOptions {
  formats?: string[];
  fields?: string[];
  outDir?: string;
  name?: string;
  query?: QueryOptions;
  /** One row per school instead of one per vacancy. */
  schoolsOnly?: boolean;
  /** Include schools outside config/directory.json, which are vacancy-only. */
  allCountries?: boolean;
  /** Push the same table to a Google Sheet. */
  sheetId?: string;
  sheetTab?: string;
  keyFile?: string;
}

export async function runExport(opts: ExportOptions = {}): Promise<{ rows: number; files: string[] }> {
  // The watch loop stays up across cycles; re-read the hiring counts.
  resetHiring();
  const fields = loadFields(opts.fields);
  const outDir = opts.outDir ?? OUT_DIR;
  const formats = opts.formats?.length ? opts.formats : ["csv", "html"];
  const files: string[] = [];

  let rows: SheetRow[];
  let scope: "job" | "school";
  let title: string;

  if (opts.schoolsOnly) {
    scope = "school";
    title = "International schools — PE profile";
    // The top-schools list answers "where should I be teaching, out of the
    // places I would move to", so it holds to the countries in
    // config/directory.json. Vacancy scraping still covers the world, and
    // --all-countries shows every school it has ever touched.
    const targets = targetCountries();
    const all = [...getSchools().values()];
    const inScope = opts.allCountries ? all : all.filter((s) => isTargetCountry(s.country, targets));
    if (!opts.allCountries && inScope.length < all.length) {
      log.info(
        `${all.length - inScope.length} schools outside config/directory.json left out ` +
          `(--all-countries to include them)`,
      );
    }
    rows = inScope.sort(byCountryRank).map((school) => ({ school }));
  } else {
    scope = "job";
    title = "International school PE vacancies";
    const targets = targetCountries();
    const jobRows = queryJobs({ peOnly: true, status: "open", ...opts.query }).filter(
      (job) => opts.allCountries || vacancyInScope(job.country, targets),
    );
    const schools = getSchools();
    rows = jobRows.map((job) => ({
      job,
      school: job.school_key ? schools.get(job.school_key) : undefined,
    }));
  }

  if (!rows.length) {
    log.warn("nothing to export yet — run a scrape first");
    return { rows: 0, files: [] };
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const base = join(outDir, `${opts.name ?? (opts.schoolsOnly ? "schools" : "pe-jobs")}-${stamp}`);

  for (const format of formats) {
    switch (format) {
      case "csv":  files.push(base + ".csv");  writeCsv(base + ".csv", rows, fields, scope); break;
      case "tsv":  files.push(base + ".tsv");  writeTsv(base + ".tsv", rows, fields, scope); break;
      case "json": files.push(base + ".json"); writeJson(base + ".json", rows, fields, scope); break;
      case "html": files.push(base + ".html"); writeHtml(base + ".html", rows, fields, scope, title); break;
      default: log.warn(`unknown format "${format}" — try csv, tsv, json or html`);
    }
  }

  const sheetId = opts.sheetId ?? process.env.GOOGLE_SHEET_ID;
  if (sheetId) {
    const { headers, body } = buildTable(rows, fields, scope);
    await syncToSheet({
      spreadsheetId: sheetId,
      tab: opts.sheetTab ?? (opts.schoolsOnly ? "Schools" : "PE Jobs"),
      keyFile: opts.keyFile,
      headers,
      rows: body,
    });
  }

  return { rows: rows.length, files };
}

export function runSite(outDir?: string, fields?: string[]): { dir: string; jobs: number; schools: number } {
  resetHiring();
  return buildSite({ outDir, fields: loadFields(fields) });
}

export function printStats(): void {
  const s = dbStats();
  log.step("Database");
  const pad = (k: string) => k.padEnd(24);
  for (const [k, v] of Object.entries(s)) log.plain(`  ${pad(k)} ${v}`);
}

export function slug(s: string): string {
  return slugify(s);
}
