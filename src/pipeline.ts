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
import { slugify } from "./core/text.ts";
import type { Job, Salary, SourceId } from "./core/types.ts";
import { fetchCountryDirectory, phaseFromOrgType, type DirectorySchool } from "./directory.ts";
import { enrichSchool, type EnrichOptions, type SchoolInput } from "./enrich/school.ts";
import { selectedCountries } from "./locations.ts";
import { buildTable, writeCsv, writeHtml, writeJson, writeTsv, type SheetRow } from "./export/sheet.ts";
import { syncToSheet } from "./export/gsheets.ts";
import { tesSource } from "./sources/tes.ts";
import { teachawaySource } from "./sources/teachaway.ts";
import { teacherHorizonsSource } from "./sources/teacherhorizons.ts";
import type { Source } from "./sources/base.ts";
import {
  expirePastDeadline,
  finishRun,
  getSchools,
  parseJsonColumn,
  queryJobs,
  recordSightings,
  schoolsNeedingEnrichment,
  startRun,
  stats as dbStats,
  sweepMissing,
  upsertJobs,
  upsertSchool,
  type JobRow,
  type QueryOptions,
} from "./store/db.ts";

export const ALL_SOURCES: Source[] = [tesSource, teachawaySource, teacherHorizonsSource];

/**
 * Sources that list their whole inventory each run. Only these can be used to
 * infer that a missing vacancy has been taken down — Teacher Horizons shows a
 * rolling window, so absence there means nothing.
 */
const ENUMERATED: SourceId[] = ["tes", "teachaway"];

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
      attachments: rows.flatMap((r) => parseJsonColumn<string[]>(r.attachments_json, [])),
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
  const picked = opts.countries?.length ? opts.countries : selectedCountries().map((c) => c.name);

  if (!picked.length) {
    log.warn("no countries selected.");
    log.plain("  Tick some first:  npm run locations -- --on AE,QA,SG");
    log.plain("  Or pass them:     npm run directory -- --countries \"United Arab Emirates,Qatar\"");
    return { countries: 0, found: 0, enriched: 0, withCareerEmail: 0, skipped: [] };
  }

  const top = opts.top ?? 30;
  log.step(`Directory — top ${top} schools in ${picked.length} countr${picked.length === 1 ? "y" : "ies"}`);

  const runId = startRun("directory");
  const all: DirectorySchool[] = [];
  const skipped: string[] = [];

  for (const country of picked) {
    const schools = await fetchCountryDirectory(country, {
      fresh: opts.fresh,
      top,
      cities: opts.cities,
    });
    if (!schools.length) skipped.push(country);
    all.push(...schools);
  }

  log.ok(`${all.length} schools collected across ${picked.length - skipped.length} countries`);

  if (opts.listOnly) {
    for (const s of all) {
      upsertSchool(
        {
          schoolKey: s.schoolKey,
          schoolName: s.name,
          country: { value: s.country, provenance: { confidence: 0.95, source: "teachaway directory" } },
          ...(s.city ? { city: { value: s.city, provenance: { confidence: 0.9, source: "teachaway directory" } } } : {}),
          ...(s.website ? { website: { value: s.website, provenance: { confidence: 0.95, source: "teachaway directory" } } } : {}),
          enrichedAt: new Date().toISOString(),
          notes: s.why,
        },
        "directory",
        all.filter((x) => x.country === s.country).indexOf(s) + 1,
      );
    }
    finishRun(runId, { countries: picked.length, found: all.length, listOnly: true });
    return { countries: picked.length, found: all.length, enriched: 0, withCareerEmail: 0, skipped };
  }

  // Rank within each country so the sheet can show "3rd in Qatar".
  const rankByKey = new Map<string, number>();
  for (const country of picked) {
    const inCountry = all.filter((s) => s.country === country);
    inCountry.forEach((s, i) => rankByKey.set(s.schoolKey, i + 1));
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

  finishRun(runId, { countries: picked.length, found: all.length, enriched: done });
  return { countries: picked.length, found: all.length, enriched: done, withCareerEmail, skipped };
}

// ---------------------------------------------------------------------------

export interface ExportOptions {
  formats?: string[];
  fields?: string[];
  outDir?: string;
  name?: string;
  query?: QueryOptions;
  /** One row per school instead of one per vacancy. */
  schoolsOnly?: boolean;
  /** Push the same table to a Google Sheet. */
  sheetId?: string;
  sheetTab?: string;
  keyFile?: string;
}

export async function runExport(opts: ExportOptions = {}): Promise<{ rows: number; files: string[] }> {
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
    rows = [...getSchools().values()]
      .sort((a, b) => (a.country ?? "").localeCompare(b.country ?? "") || a.name.localeCompare(b.name))
      .map((school) => ({ school }));
  } else {
    scope = "job";
    title = "International school PE vacancies";
    const jobRows = queryJobs({ peOnly: true, status: "open", ...opts.query });
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

export function printStats(): void {
  const s = dbStats();
  log.step("Database");
  const pad = (k: string) => k.padEnd(24);
  for (const [k, v] of Object.entries(s)) log.plain(`  ${pad(k)} ${v}`);
}

export function slug(s: string): string {
  return slugify(s);
}
