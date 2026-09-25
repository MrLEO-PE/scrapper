/**
 * Persistence: node:sqlite (built into Node 22, so no native module to build).
 *
 * The database is what makes this more than a one-shot scrape:
 *   - it remembers every vacancy ever seen, so a thin source like Teacher
 *     Horizons accumulates coverage over daily runs;
 *   - it tracks a vacancy's lifecycle (open -> stale -> closed) so the sheet
 *     can say whether a role is still available;
 *   - it caches school enrichment, which is the expensive part, and lets the
 *     directory mode share the same school table as the job-driven one.
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { log } from "../core/logger.ts";
import { hostOf, schoolCore } from "../core/text.ts";
import { findMatch, preferred, sameSchool, type SchoolIdentity } from "./identity.ts";
import { rankByValue } from "../match/packagevalue.ts";
import type { Job, Salary, SchoolProfile, SourceId } from "../core/types.ts";

export type JobStatus = "open" | "stale" | "closed";

export const DB_PATH = process.env.SCRAPPER_DB || join(process.cwd(), "data", "jobs.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id              TEXT PRIMARY KEY,
  source          TEXT NOT NULL,
  source_job_id   TEXT NOT NULL,
  dedupe_key      TEXT NOT NULL,
  title           TEXT NOT NULL,
  url             TEXT NOT NULL,
  school_name     TEXT,
  school_key      TEXT,
  country         TEXT,
  city            TEXT,
  description     TEXT,
  posted_at       TEXT,
  deadline_at     TEXT,
  start_date      TEXT,
  salary_json     TEXT,
  contract_type   TEXT,
  contract_term   TEXT,
  curriculum_json TEXT,
  grade_json      TEXT,
  benefits_json   TEXT,
  school_website  TEXT,
  emails_json     TEXT,
  application_url TEXT,
  attachments_json TEXT,
  pe_score        INTEGER NOT NULL DEFAULT 0,
  pe_seniority    TEXT,
  pe_matched_json TEXT,
  is_pe           INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'open',
  first_seen_at   TEXT NOT NULL,
  last_seen_at    TEXT NOT NULL,
  closed_at       TEXT,
  last_checked_at TEXT,
  alerted_at      TEXT,
  my_status       TEXT,
  my_status_at    TEXT,
  my_note         TEXT,
  app_form        TEXT,
  app_form_url    TEXT,
  raw_json        TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_dedupe  ON jobs(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_jobs_school  ON jobs(school_key);
CREATE INDEX IF NOT EXISTS idx_jobs_status  ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_pe      ON jobs(is_pe, pe_score);

CREATE TABLE IF NOT EXISTS schools (
  school_key      TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  country         TEXT,
  city            TEXT,
  website         TEXT,
  curriculum_json TEXT,
  pe_team_size    INTEGER,
  student_count   INTEGER,
  school_type     TEXT,
  salary_json     TEXT,
  package_json    TEXT,
  school_email    TEXT,
  career_email    TEXT,
  careers_url     TEXT,
  principal       TEXT,
  school_hook     TEXT,
  pe_hook         TEXT,
  emails_json     TEXT,
  provenance_json TEXT,
  notes_json      TEXT,
  origin          TEXT NOT NULL DEFAULT 'job',
  country_rank    INTEGER,
  accreditation   TEXT,
  prominence      INTEGER,
  package_score   INTEGER,
  rank_basis      TEXT,
  social          TEXT,
  fee_low         INTEGER,
  fee_high        INTEGER,
  fee_currency    TEXT,
  phone           TEXT,
  enriched_at     TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schools_country ON schools(country);
CREATE INDEX IF NOT EXISTS idx_schools_origin  ON schools(origin);

CREATE TABLE IF NOT EXISTS runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  mode        TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  stats_json  TEXT
);

CREATE TABLE IF NOT EXISTS sightings (
  run_id  INTEGER NOT NULL,
  job_id  TEXT NOT NULL,
  seen_at TEXT NOT NULL,
  PRIMARY KEY (run_id, job_id)
);
`;

let db: DatabaseSync | null = null;

/**
 * Columns added after the first release. `CREATE TABLE IF NOT EXISTS` leaves an
 * existing database untouched, so new columns are applied here instead —
 * keeping older databases usable without a manual rebuild.
 */
const MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  { table: "jobs", column: "attachments_json", ddl: "ALTER TABLE jobs ADD COLUMN attachments_json TEXT" },
  // When this vacancy was last included in an alert, so a daily run does not
  // report the same role every morning.
  { table: "jobs", column: "alerted_at", ddl: "ALTER TABLE jobs ADD COLUMN alerted_at TEXT" },
  // Whether the school makes you complete an application form, and where it is.
  { table: "jobs", column: "app_form", ddl: "ALTER TABLE jobs ADD COLUMN app_form TEXT" },
  { table: "jobs", column: "app_form_url", ddl: "ALTER TABLE jobs ADD COLUMN app_form_url TEXT" },
  // Details the prepared application email needs.
  { table: "schools", column: "principal", ddl: "ALTER TABLE schools ADD COLUMN principal TEXT" },
  { table: "schools", column: "school_hook", ddl: "ALTER TABLE schools ADD COLUMN school_hook TEXT" },
  { table: "schools", column: "pe_hook", ddl: "ALTER TABLE schools ADD COLUMN pe_hook TEXT" },
  // Your own pipeline state. Written only by you, never by a scrape.
  { table: "jobs", column: "my_status", ddl: "ALTER TABLE jobs ADD COLUMN my_status TEXT" },
  { table: "jobs", column: "my_status_at", ddl: "ALTER TABLE jobs ADD COLUMN my_status_at TEXT" },
  { table: "jobs", column: "my_note", ddl: "ALTER TABLE jobs ADD COLUMN my_note TEXT" },
  // Exactly what a salary figure is: one advert, an average, or a benchmark.
  { table: "schools", column: "salary_basis", ddl: "ALTER TABLE schools ADD COLUMN salary_basis TEXT" },
  // Which bodies accredit the school — the main signal behind its rank.
  { table: "schools", column: "accreditation", ddl: "ALTER TABLE schools ADD COLUMN accreditation TEXT" },
  // The directory's proxy score, kept so a rank can fall back to it when the
  // school has no package evidence yet.
  /*
   * Deliberately left empty for existing rows, to be filled by the next
   * directory listing.
   *
   * The obvious shortcut — recovering a score by inverting the stored
   * country_rank — puts two incompatible scales in one column: a real score
   * tops out near 70, while inverting a rank in a 200-school country yields
   * 137. The invented number then outranks genuinely accredited schools. A
   * null is honest and costs one listing run to fix.
   */
  { table: "schools", column: "prominence", ddl: "ALTER TABLE schools ADD COLUMN prominence INTEGER" },
  // What a country rank was decided on, and the package score behind it.
  { table: "schools", column: "package_score", ddl: "ALTER TABLE schools ADD COLUMN package_score INTEGER" },
  { table: "schools", column: "rank_basis", ddl: "ALTER TABLE schools ADD COLUMN rank_basis TEXT" },
  // A Facebook or Instagram page, for schools that have no website at all.
  { table: "schools", column: "social", ddl: "ALTER TABLE schools ADD COLUMN social TEXT" },
  // Published by the directory; the only route left when no email exists.
  { table: "schools", column: "phone", ddl: "ALTER TABLE schools ADD COLUMN phone TEXT" },
  // Yearly tuition. The first per-school money signal available anywhere: a
  // country salary benchmark is identical for every school in a country, so it
  // cannot rank them against each other. Fees can.
  { table: "schools", column: "fee_low", ddl: "ALTER TABLE schools ADD COLUMN fee_low INTEGER" },
  { table: "schools", column: "fee_high", ddl: "ALTER TABLE schools ADD COLUMN fee_high INTEGER" },
  { table: "schools", column: "fee_currency", ddl: "ALTER TABLE schools ADD COLUMN fee_currency TEXT" },
];

function migrate(d: DatabaseSync): void {
  for (const m of MIGRATIONS) {
    try {
      const cols = d.prepare(`PRAGMA table_info(${m.table})`).all() as { name: string }[];
      if (!cols.length) continue; // table not created yet; SCHEMA covers it
      if (cols.some((c) => c.name === m.column)) continue;
      d.exec(m.ddl);
      log.debug(`migrated: ${m.table}.${m.column}`);
    } catch (err) {
      log.warn(`migration ${m.table}.${m.column} failed: ${(err as Error).message}`);
    }
  }
}

export function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}

const j = (v: unknown): string | null => (v == null ? null : JSON.stringify(v));
const unj = <T>(s: unknown, fallback: T): T => {
  if (typeof s !== "string" || !s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

export interface UpsertResult {
  inserted: number;
  updated: number;
  reopened: number;
}

/** Insert new vacancies, refresh ones we already know. */
export function upsertJobs(jobs: Job[], runId: number): UpsertResult {
  const d = getDb();
  const now = new Date().toISOString();
  const res: UpsertResult = { inserted: 0, updated: 0, reopened: 0 };

  const existing = d.prepare("SELECT id, status FROM jobs WHERE id = ?");
  const insert = d.prepare(`
    INSERT INTO jobs (
      id, source, source_job_id, dedupe_key, title, url, school_name, school_key,
      country, city, description, posted_at, deadline_at, start_date, salary_json,
      contract_type, contract_term, curriculum_json, grade_json, benefits_json,
      school_website, emails_json, application_url, pe_score, pe_seniority,
      pe_matched_json, is_pe, attachments_json, app_form, app_form_url, status, first_seen_at, last_seen_at, last_checked_at, raw_json
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?
    )`);
  const update = d.prepare(`
    UPDATE jobs SET
      title = ?, url = ?, school_name = ?, school_key = ?, country = ?, city = ?,
      description = COALESCE(NULLIF(?, ''), description),
      posted_at = COALESCE(?, posted_at), deadline_at = COALESCE(?, deadline_at),
      start_date = COALESCE(?, start_date), salary_json = COALESCE(?, salary_json),
      contract_type = COALESCE(?, contract_type), contract_term = COALESCE(?, contract_term),
      curriculum_json = COALESCE(?, curriculum_json), grade_json = COALESCE(?, grade_json),
      benefits_json = COALESCE(?, benefits_json), school_website = COALESCE(?, school_website),
      emails_json = COALESCE(?, emails_json), application_url = COALESCE(?, application_url),
      pe_score = ?, pe_seniority = ?, pe_matched_json = ?, is_pe = ?,
      attachments_json = COALESCE(?, attachments_json),
      app_form = COALESCE(?, app_form), app_form_url = COALESCE(?, app_form_url),
      status = 'open', closed_at = NULL, last_seen_at = ?, last_checked_at = ?
    WHERE id = ?`);
  const sight = d.prepare("INSERT OR IGNORE INTO sightings (run_id, job_id, seen_at) VALUES (?, ?, ?)");

  d.exec("BEGIN");
  try {
    for (const job of jobs) {
      const prev = existing.get(job.id) as { id: string; status: string } | undefined;
      const schoolKeyValue = job.schoolName ? job.dedupeKey.split("::")[0] ?? null : null;

      if (!prev) {
        insert.run(
          job.id, job.source, job.sourceJobId, job.dedupeKey, job.title, job.url,
          job.schoolName ?? null, schoolKeyValue, job.country ?? null, job.city ?? null,
          job.description ?? null, job.postedAt ?? null, job.deadlineAt ?? null,
          job.startDate ?? null, j(job.salary), job.contractType ?? null,
          job.contractTerm ?? null, j(job.curriculum), j(job.gradeLevels),
          j(job.benefits), job.schoolWebsite ?? null, j(job.schoolEmails),
          job.applicationUrl ?? null, job.pe.score, job.pe.seniority,
          j(job.pe.matched), job.pe.isPe ? 1 : 0, j(job.attachments),
          job.applicationForm?.kind ?? null, job.applicationForm?.url ?? null,
          job.firstSeenAt, now, now, j(job.raw),
        );
        res.inserted++;
      } else {
        if (prev.status === "closed") res.reopened++;
        update.run(
          job.title, job.url, job.schoolName ?? null, schoolKeyValue,
          job.country ?? null, job.city ?? null, job.description ?? "",
          job.postedAt ?? null, job.deadlineAt ?? null, job.startDate ?? null,
          j(job.salary), job.contractType ?? null, job.contractTerm ?? null,
          j(job.curriculum), j(job.gradeLevels), j(job.benefits),
          job.schoolWebsite ?? null, j(job.schoolEmails), job.applicationUrl ?? null,
          job.pe.score, job.pe.seniority, j(job.pe.matched), job.pe.isPe ? 1 : 0,
          j(job.attachments),
          job.applicationForm?.kind ?? null, job.applicationForm?.url ?? null,
          now, now, job.id,
        );
        res.updated++;
      }
      sight.run(runId, job.id, now);
    }
    d.exec("COMMIT");
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }
  return res;
}

/**
 * Record that these job ids were seen in this run, without writing job rows.
 *
 * Needed for cross-board duplicates: when the same vacancy appears on two
 * boards we keep only the richer record, but the discarded one is still live
 * on its own board. Without a sighting it would look like it had disappeared
 * and the sweep below would wrongly close it.
 */
export function recordSightings(runId: number, jobIds: string[]): void {
  if (!jobIds.length) return;
  const d = getDb();
  const stmt = d.prepare("INSERT OR IGNORE INTO sightings (run_id, job_id, seen_at) VALUES (?, ?, ?)");
  const now = new Date().toISOString();
  d.exec("BEGIN");
  try {
    for (const id of jobIds) stmt.run(runId, id, now);
    d.exec("COMMIT");
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }
}

/**
 * Lifecycle sweep. A vacancy from a source that fully enumerates its listings
 * and did NOT appear in this run has probably been taken down: mark it stale
 * on the first miss, closed on the second. Sources that only expose a rolling
 * window (Teacher Horizons) are exempt — absence there means nothing.
 */
export function sweepMissing(runId: number, enumeratedSources: SourceId[]): { stale: number; closed: number } {
  if (!enumeratedSources.length) return { stale: 0, closed: 0 };
  const d = getDb();
  const now = new Date().toISOString();
  const marks = enumeratedSources.map(() => "?").join(",");

  const staled = d
    .prepare(
      `UPDATE jobs SET status = 'stale', last_checked_at = ?
       WHERE status = 'open' AND source IN (${marks})
         AND id NOT IN (SELECT job_id FROM sightings WHERE run_id = ?)`,
    )
    .run(now, ...enumeratedSources, runId);

  const closed = d
    .prepare(
      `UPDATE jobs SET status = 'closed', closed_at = ?, last_checked_at = ?
       WHERE status = 'stale' AND source IN (${marks})
         AND id NOT IN (SELECT job_id FROM sightings WHERE run_id = ?)
         AND last_seen_at < ?`,
    )
    .run(now, now, ...enumeratedSources, runId, now);

  return { stale: Number(staled.changes ?? 0), closed: Number(closed.changes ?? 0) };
}

/** Deadline-based expiry, independent of whether a source still lists the job. */
export function expirePastDeadline(): number {
  const now = new Date().toISOString();
  const r = getDb()
    .prepare(
      `UPDATE jobs SET status = 'closed', closed_at = ?, last_checked_at = ?
       WHERE status != 'closed' AND deadline_at IS NOT NULL AND deadline_at < ?`,
    )
    .run(now, now, now);
  return Number(r.changes ?? 0);
}

export function startRun(mode: string): number {
  const r = getDb()
    .prepare("INSERT INTO runs (mode, started_at) VALUES (?, ?)")
    .run(mode, new Date().toISOString());
  return Number(r.lastInsertRowid);
}

export function finishRun(runId: number, stats: unknown): void {
  getDb()
    .prepare("UPDATE runs SET finished_at = ?, stats_json = ? WHERE id = ?")
    .run(new Date().toISOString(), j(stats), runId);
}

export interface JobRow {
  id: string;
  source: SourceId;
  title: string;
  url: string;
  school_name: string | null;
  school_key: string | null;
  country: string | null;
  city: string | null;
  description: string | null;
  posted_at: string | null;
  deadline_at: string | null;
  start_date: string | null;
  salary_json: string | null;
  contract_type: string | null;
  benefits_json: string | null;
  curriculum_json: string | null;
  school_website: string | null;
  emails_json: string | null;
  application_url: string | null;
  attachments_json: string | null;
  pe_score: number;
  pe_seniority: string | null;
  is_pe: number;
  status: JobStatus;
  first_seen_at: string;
  last_seen_at: string;
  alerted_at: string | null;
  my_status: string | null;
  my_status_at: string | null;
  my_note: string | null;
  app_form: string | null;
  app_form_url: string | null;
}

export interface QueryOptions {
  peOnly?: boolean;
  status?: JobStatus | "any";
  minScore?: number;
  countries?: string[];
  seniority?: string[];
  /** ISO date; only jobs first seen on/after it. */
  since?: string;
  limit?: number;
}

export function queryJobs(opts: QueryOptions = {}): JobRow[] {
  const where: string[] = [];
  const args: (string | number)[] = [];

  if (opts.peOnly !== false) where.push("is_pe = 1");
  if (opts.status && opts.status !== "any") {
    where.push("status = ?");
    args.push(opts.status);
  }
  if (opts.minScore != null) {
    where.push("pe_score >= ?");
    args.push(opts.minScore);
  }
  if (opts.since) {
    where.push("first_seen_at >= ?");
    args.push(opts.since);
  }
  if (opts.countries?.length) {
    where.push(`(${opts.countries.map(() => "LOWER(country) LIKE ?").join(" OR ")})`);
    for (const c of opts.countries) args.push(`%${c.toLowerCase()}%`);
  }
  if (opts.seniority?.length) {
    where.push(`pe_seniority IN (${opts.seniority.map(() => "?").join(",")})`);
    args.push(...opts.seniority);
  }

  const sql =
    "SELECT * FROM jobs" +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY pe_score DESC, last_seen_at DESC" +
    (opts.limit ? ` LIMIT ${Number(opts.limit)}` : "");

  return getDb().prepare(sql).all(...args) as unknown as JobRow[];
}

/** Schools referenced by stored vacancies, newest activity first. */
/**
 * Schools due a profile.
 *
 * Two kinds qualify, and both matter: schools behind a live PE vacancy, and
 * schools collected by the standing directory, which have no vacancy at all.
 * The second is the whole point of directory mode — researching a school
 * before it advertises — so a query over the jobs table alone would never
 * reach them.
 *
 * Vacancy-backed schools come first: a live role is more urgent than a survey.
 */
export function schoolsNeedingEnrichment(maxAgeDays = 30, limit = 0): { school_key: string; name: string; country: string | null; city: string | null; website: string | null }[] {
  const cutoff = new Date(Date.now() - maxAgeDays * 86400_000).toISOString();
  const sql = `
    SELECT school_key, name, country, city, website, priority FROM (
      SELECT j.school_key            AS school_key,
             MAX(j.school_name)      AS name,
             MAX(j.country)          AS country,
             MAX(j.city)             AS city,
             MAX(j.school_website)   AS website,
             0                       AS priority,
             MAX(j.pe_score)         AS rank_score
        FROM jobs j
        LEFT JOIN schools s ON s.school_key = j.school_key
       WHERE j.school_key IS NOT NULL AND j.is_pe = 1
         AND (s.enriched_at IS NULL OR s.enriched_at < ?)
       GROUP BY j.school_key

      UNION ALL

      -- Directory schools, best-ranked in their country first.
      SELECT s.school_key, s.name, s.country, s.city, s.website,
             1 AS priority,
             -COALESCE(s.country_rank, 9999) AS rank_score
        FROM schools s
       WHERE s.origin = 'directory'
         AND (s.enriched_at IS NULL OR s.enriched_at < ?)
         AND s.school_key NOT IN (
               SELECT DISTINCT school_key FROM jobs
                WHERE school_key IS NOT NULL AND is_pe = 1
             )
    )
    ORDER BY priority ASC, rank_score DESC
    ${limit ? `LIMIT ${Number(limit)}` : ""}`;
  return getDb().prepare(sql).all(cutoff, cutoff) as any;
}

/*
 * Aliased to the field names SchoolIdentity uses. Selecting the raw snake_case
 * columns and casting silently gives every row an undefined `schoolKey`, which
 * makes each one look identical to every other and defeats matching entirely.
 */
const IDENTITY_COLUMNS = "school_key AS schoolKey, name, country, city, website, origin";

/**
 * Rows that could be the same school as this one: anything sharing the name
 * core, plus anything on the same website.
 */
function identityCandidates(core: string, host?: string): { rows: SchoolIdentity[]; peersOnHost: number } {
  const d = getDb();
  const byName = d
    .prepare(`SELECT ${IDENTITY_COLUMNS} FROM schools WHERE school_key = ? OR school_key LIKE ?`)
    .all(core, `${core}|%`) as unknown as SchoolIdentity[];

  if (!host) return { rows: byName, peersOnHost: 1 };

  // LIKE is a coarse filter; hostOf decides, so a path containing the host
  // cannot masquerade as the host.
  const byHost = (
    d.prepare(`SELECT ${IDENTITY_COLUMNS} FROM schools WHERE website LIKE ?`).all(`%${host}%`) as unknown as SchoolIdentity[]
  ).filter((r) => hostOf(r.website) === host);

  const seen = new Set(byName.map((r) => r.schoolKey));
  return {
    rows: [...byName, ...byHost.filter((r) => !seen.has(r.schoolKey))],
    peersOnHost: new Set(byHost.map((r) => schoolCore(r.name))).size || 1,
  };
}

/**
 * Where this profile should actually be written.
 *
 * Returns the existing row's key when the school is already stored under a
 * different one, so a second record is never created. `keepExistingPlace`
 * says the stored country and city are the better ones and must not be
 * overwritten — a directory listing knows which country page it came from,
 * whereas a vacancy's location is free text.
 */
function resolveSchoolKey(
  p: SchoolProfile,
  origin: string,
): { key: string; name: string; keepExistingPlace: boolean } {
  const d = getDb();
  const exists = d.prepare("SELECT 1 FROM schools WHERE school_key = ?").get(p.schoolKey);
  if (exists) return { key: p.schoolKey, name: p.schoolName, keepExistingPlace: false };

  const candidate: SchoolIdentity = {
    schoolKey: p.schoolKey,
    name: p.schoolName,
    country: p.country?.value ?? null,
    city: p.city?.value ?? null,
    website: p.website?.value ?? null,
    origin,
  };
  const host = hostOf(candidate.website);
  const { rows, peersOnHost } = identityCandidates(schoolCore(p.schoolName), host);

  const hit = findMatch(candidate, rows, peersOnHost);
  if (!hit) return { key: p.schoolKey, name: p.schoolName, keepExistingPlace: false };

  log.debug(`school: "${p.schoolName}" is ${hit.existing.schoolKey} (${hit.reason}) — updating, not duplicating`);

  // Any vacancies already filed under the key we are abandoning have to follow
  // the school, or the sheet loses their school columns.
  d.prepare("UPDATE jobs SET school_key = ? WHERE school_key = ?").run(hit.existing.schoolKey, p.schoolKey);

  const keepExisting = preferred(hit.existing, candidate) === hit.existing;
  return {
    key: hit.existing.schoolKey,
    // Keeping the stored name too, so a school does not flip between its two
    // spellings depending on which source ran last.
    name: keepExisting ? hit.existing.name : p.schoolName,
    keepExistingPlace: keepExisting,
  };
}

export function upsertSchool(
  p: SchoolProfile,
  origin: "job" | "directory" = "job",
  countryRank?: number,
  /** False when only listing a school, so a later run still profiles it. */
  markEnriched = true,
): void {
  const { key: schoolKeyToUse, name: nameToUse, keepExistingPlace } = resolveSchoolKey(p, origin);
  const now = new Date().toISOString();
  const provenance: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v && typeof v === "object" && "provenance" in (v as object)) {
      provenance[k] = (v as { provenance: unknown }).provenance;
    }
  }

  getDb()
    .prepare(
      `INSERT INTO schools (
        school_key, name, country, city, website, curriculum_json, pe_team_size,
        student_count, school_type, salary_json, package_json, school_email,
        career_email, careers_url, principal, school_hook, pe_hook, salary_basis,
        emails_json, provenance_json, notes_json,
        origin, country_rank, accreditation, prominence, social, phone,
        fee_low, fee_high, fee_currency, enriched_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(school_key) DO UPDATE SET
        name = excluded.name,
        country = COALESCE(excluded.country, schools.country),
        city = COALESCE(excluded.city, schools.city),
        website = COALESCE(excluded.website, schools.website),
        curriculum_json = COALESCE(excluded.curriculum_json, schools.curriculum_json),
        pe_team_size = COALESCE(excluded.pe_team_size, schools.pe_team_size),
        student_count = COALESCE(excluded.student_count, schools.student_count),
        school_type = COALESCE(excluded.school_type, schools.school_type),
        salary_json = COALESCE(excluded.salary_json, schools.salary_json),
        package_json = COALESCE(excluded.package_json, schools.package_json),
        -- Enrichment recomputes both addresses from the same candidate set, so
        -- a fresh run must be able to move an address from one column to the
        -- other. COALESCE alone would strand the previous value.
        school_email = CASE WHEN excluded.emails_json IS NOT NULL
                            THEN excluded.school_email
                            ELSE COALESCE(excluded.school_email, schools.school_email) END,
        career_email = CASE WHEN excluded.emails_json IS NOT NULL
                            THEN excluded.career_email
                            ELSE COALESCE(excluded.career_email, schools.career_email) END,
        careers_url = COALESCE(excluded.careers_url, schools.careers_url),
        principal = COALESCE(excluded.principal, schools.principal),
        school_hook = COALESCE(excluded.school_hook, schools.school_hook),
        pe_hook = COALESCE(excluded.pe_hook, schools.pe_hook),
        salary_basis = COALESCE(excluded.salary_basis, schools.salary_basis),
        emails_json = COALESCE(excluded.emails_json, schools.emails_json),
        provenance_json = excluded.provenance_json,
        notes_json = excluded.notes_json,
        country_rank = COALESCE(excluded.country_rank, schools.country_rank),
        accreditation = COALESCE(excluded.accreditation, schools.accreditation),
        prominence = COALESCE(excluded.prominence, schools.prominence),
        social = COALESCE(excluded.social, schools.social),
        phone = COALESCE(excluded.phone, schools.phone),
        fee_low = COALESCE(excluded.fee_low, schools.fee_low),
        fee_high = COALESCE(excluded.fee_high, schools.fee_high),
        fee_currency = COALESCE(excluded.fee_currency, schools.fee_currency),
        enriched_at = COALESCE(excluded.enriched_at, schools.enriched_at)`,
    )
    .run(
      schoolKeyToUse, nameToUse,
      keepExistingPlace ? null : (p.country?.value ?? null),
      keepExistingPlace ? null : (p.city?.value ?? null),
      p.website?.value ?? null, j(p.curriculum?.value), p.peTeamSize?.value ?? null,
      p.studentCount?.value ?? null, p.schoolType?.value ?? null, j(p.salaryEstimate?.value),
      j(p.packageNotes?.value), p.schoolEmail?.value ?? null, p.careerEmail?.value ?? null,
      p.careersPageUrl?.value ?? null,
      p.principal?.value ?? null, p.schoolHook?.value ?? null, p.peHook?.value ?? null,
      p.salaryBasis ?? null,
      j(p.allEmails), j(provenance), j(p.notes),
      origin, countryRank ?? null, p.accreditation ?? null, p.prominence ?? null,
      p.social?.value ?? null, p.phone?.value ?? null,
      p.fees?.low ?? null, p.fees?.high ?? null, p.fees?.currency ?? null,
      markEnriched ? (p.enrichedAt ?? now) : null, now,
    );
}

export interface SchoolRow {
  school_key: string;
  name: string;
  country: string | null;
  city: string | null;
  website: string | null;
  curriculum_json: string | null;
  pe_team_size: number | null;
  student_count: number | null;
  school_type: string | null;
  salary_json: string | null;
  salary_basis: string | null;
  package_json: string | null;
  school_email: string | null;
  career_email: string | null;
  careers_url: string | null;
  principal: string | null;
  school_hook: string | null;
  pe_hook: string | null;
  emails_json: string | null;
  origin: string;
  country_rank: number | null;
  accreditation: string | null;
  prominence: number | null;
  package_score: number | null;
  rank_basis: string | null;
  social: string | null;
  fee_low: number | null;
  fee_high: number | null;
  fee_currency: string | null;
  phone: string | null;
  enriched_at: string | null;
}

/**
 * Reading order for any school list: country, then its rank within that
 * country. The list is meant to be read top-down as "the schools to be at
 * here", so alphabetical order would waste it. Unranked schools sort last, and
 * ties resolve by name so the order never changes between runs.
 */
export function byCountryRank(a: SchoolRow, b: SchoolRow): number {
  return (
    (a.country ?? "").localeCompare(b.country ?? "") ||
    (a.country_rank ?? Number.MAX_SAFE_INTEGER) - (b.country_rank ?? Number.MAX_SAFE_INTEGER) ||
    a.name.localeCompare(b.name)
  );
}

/**
 * Schools with no website, best-ranked first — the queue for site discovery.
 *
 * Any address already held comes along, because its domain is usually the
 * website and costs nothing to check.
 */
export function getSchoolsNeedingWebsite(
  countries: Set<string>,
  limit = 0,
): { school_key: string; name: string; country: string | null; career_email: string | null; school_email: string | null }[] {
  const rows = getDb()
    .prepare(
      `SELECT school_key, name, country, career_email, school_email
         FROM schools
        WHERE website IS NULL AND country IS NOT NULL
        ORDER BY COALESCE(country_rank, 9999)`,
    )
    .all() as { school_key: string; name: string; country: string | null; career_email: string | null; school_email: string | null }[];

  const wanted = rows.filter((r) => {
    const c = r.country?.trim().toLowerCase();
    return !!c && countries.has(c);
  });
  return limit > 0 ? wanted.slice(0, limit) : wanted;
}

export function getSchools(keys?: string[]): Map<string, SchoolRow> {
  const d = getDb();
  const rows = (
    keys?.length
      ? d.prepare(`SELECT * FROM schools WHERE school_key IN (${keys.map(() => "?").join(",")})`).all(...keys)
      : d.prepare("SELECT * FROM schools").all()
  ) as unknown as SchoolRow[];
  return new Map(rows.map((r) => [r.school_key, r]));
}

export interface HiringHistory {
  /** Distinct PE vacancies ever recorded for this school. */
  postings: number;
  /** ISO date this school was first observed. */
  firstSeen: string;
  /** Months between the first sighting and now. */
  monthsObserved: number;
}

/**
 * How often each school has advertised a PE role.
 *
 * A school that keeps re-advertising the same post is telling you something
 * about how long people stay. This is only meaningful once the database has
 * been running for a while — see `turnoverLabel`, which refuses to judge
 * before then.
 *
 * Counted by `dedupe_key` rather than `id` so the same vacancy appearing on
 * two boards is one posting, not two.
 */
export function hiringHistory(): Map<string, HiringHistory> {
  const rows = getDb()
    .prepare(
      `SELECT school_key,
              COUNT(DISTINCT dedupe_key) AS postings,
              MIN(first_seen_at)         AS first_seen
         FROM jobs
        WHERE is_pe = 1 AND school_key IS NOT NULL
        GROUP BY school_key`,
    )
    .all() as unknown as { school_key: string; postings: number; first_seen: string }[];

  const out = new Map<string, HiringHistory>();
  for (const r of rows) {
    const start = Date.parse(r.first_seen);
    const months = Number.isNaN(start) ? 0 : (Date.now() - start) / (30.44 * 86_400_000);
    out.set(r.school_key, {
      postings: Number(r.postings),
      firstSeen: r.first_seen,
      monthsObserved: months,
    });
  }
  return out;
}

export function parseJsonColumn<T>(value: string | null, fallback: T): T {
  return unj(value, fallback);
}

export interface OpenRoles {
  count: number;
  /** Titles of the roles open right now, best-known first. */
  titles: string[];
  /** Link to one of them, so the sheet cell can be acted on. */
  url: string;
  /** Soonest deadline among them, ISO, when any is known. */
  deadline?: string;
}

/**
 * Which schools have a PE vacancy open right now.
 *
 * The top-schools list is deliberately not about who is advertising — a school
 * belongs there whether or not it has a vacancy this week. But when it does
 * have one, that is the moment to act on it, so the list says so in a column
 * rather than making you cross-reference two tabs.
 */
export function openRolesBySchool(): Map<string, OpenRoles> {
  const rows = getDb()
    .prepare(
      `SELECT school_key, title, url, deadline_at
         FROM jobs
        WHERE is_pe = 1 AND status = 'open' AND school_key IS NOT NULL
        ORDER BY COALESCE(deadline_at, '9999') ASC`,
    )
    .all() as { school_key: string; title: string; url: string; deadline_at: string | null }[];

  const out = new Map<string, OpenRoles>();
  for (const r of rows) {
    const found = out.get(r.school_key) ?? { count: 0, titles: [], url: r.url };
    found.count++;
    found.titles.push(r.title);
    found.deadline ??= r.deadline_at ?? undefined;
    out.set(r.school_key, found);
  }
  return out;
}

export interface DedupeResult {
  merged: { kept: string; removed: string; name: string; reason: string }[];
  scanned: number;
}

/**
 * Fold duplicates that were stored before the write path learned to recognise
 * them.
 *
 * Column by column, a value is only taken from the row being removed where the
 * row being kept has nothing — so this cannot lose evidence, only combine it.
 * That is the point: the vacancy row typically holds the salary while the
 * directory row holds the accreditation.
 */
export function dedupeSchools(dryRun = false): DedupeResult {
  const d = getDb();
  const all = d
    .prepare(`SELECT ${IDENTITY_COLUMNS} FROM schools`)
    .all() as unknown as SchoolIdentity[];

  const peers = new Map<string, Set<string>>();
  for (const r of all) {
    const h = hostOf(r.website);
    if (!h) continue;
    if (!peers.has(h)) peers.set(h, new Set());
    peers.get(h)!.add(schoolCore(r.name));
  }

  const merged: DedupeResult["merged"] = [];
  const gone = new Set<string>();

  for (let i = 0; i < all.length; i++) {
    const a = all[i]!;
    if (gone.has(a.schoolKey)) continue;
    for (let j = i + 1; j < all.length; j++) {
      const b = all[j]!;
      if (gone.has(b.schoolKey)) continue;

      const host = hostOf(a.website);
      const reason = sameSchool(a, b, host ? (peers.get(host)?.size ?? 1) : 1);
      if (!reason) continue;

      const keep = preferred(a, b);
      const drop = keep === a ? b : a;
      merged.push({ kept: keep.schoolKey, removed: drop.schoolKey, name: keep.name, reason });
      gone.add(drop.schoolKey);
      if (!dryRun) foldSchool(drop.schoolKey, keep.schoolKey);
    }
  }

  return { merged, scanned: all.length };
}

/** Columns worth carrying over from a duplicate, where the survivor is empty. */
const FOLDABLE = [
  "city", "website", "curriculum_json", "pe_team_size", "student_count", "school_type",
  "salary_json", "salary_basis", "package_json", "school_email", "career_email",
  "careers_url", "principal", "school_hook", "pe_hook", "emails_json", "accreditation",
  "prominence", "enriched_at",
];

function foldSchool(fromKey: string, intoKey: string): void {
  const d = getDb();
  const sets = FOLDABLE.map((c) => `${c} = COALESCE(${c}, (SELECT ${c} FROM schools WHERE school_key = ?))`).join(", ");
  d.prepare(`UPDATE schools SET ${sets} WHERE school_key = ?`).run(...FOLDABLE.map(() => fromKey), intoKey);
  // Vacancies follow the school, or the sheet loses their school columns.
  d.prepare("UPDATE jobs SET school_key = ? WHERE school_key = ?").run(intoKey, fromKey);
  d.prepare("DELETE FROM schools WHERE school_key = ?").run(fromKey);
}

export interface RerankResult {
  countries: number;
  schools: number;
  /** How many ranks rest on real package evidence rather than a proxy. */
  onPackage: number;
  onSalary: number;
  onProxy: number;
}

/**
 * Recompute every country's ranking from what a teacher would actually be paid
 * and given.
 *
 * This has to run *after* enrichment, not during it: a school's package is not
 * known until its site has been read, so the rank a directory listing gets is
 * only ever provisional. Re-ranking as a separate pass is what lets the final
 * order reflect the package rather than the order the directory happened to
 * return schools in.
 */
export function rerankCountries(): RerankResult {
  const d = getDb();
  const rows = d
    .prepare(
      `SELECT school_key, name, country, package_json, salary_json, prominence, fee_high, fee_currency
         FROM schools
        WHERE country IS NOT NULL AND country <> ''`,
    )
    .all() as Pick<
    SchoolRow,
    "school_key" | "name" | "country" | "package_json" | "salary_json" | "prominence" | "fee_high" | "fee_currency"
  >[];

  const byCountry = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = r.country!;
    byCountry.set(key, [...(byCountry.get(key) ?? []), r]);
  }

  const write = d.prepare(
    `UPDATE schools SET country_rank = ?, package_score = ?, rank_basis = ? WHERE school_key = ?`,
  );
  const result: RerankResult = { countries: 0, schools: 0, onPackage: 0, onSalary: 0, onProxy: 0 };

  for (const [, group] of byCountry) {
    const ranked = rankByValue(
      group.map((r) => {
        const salary = unj<Salary | null>(r.salary_json, null);
        return {
          schoolKey: r.school_key,
          name: r.name,
          packageTerms: unj<string[]>(r.package_json, []),
          salaryMin: salary?.min ?? null,
          salaryMax: salary?.max ?? null,
          salaryCurrency: salary?.currency ?? null,
          salaryPeriod: salary?.period ?? null,
          // A school listed but never profiled keeps the directory's proxy
          // score, and its rank says so rather than implying a poor package.
          accreditationScore: r.prominence ?? 0,
          feeHigh: r.fee_high,
          feeCurrency: r.fee_currency,
        };
      }),
    );

    for (const s of ranked) {
      write.run(s.rank, s.packageScore, s.basis, s.schoolKey);
      if (s.basis === "package") result.onPackage++;
      else if (s.basis === "package+salary") result.onSalary++;
      else result.onProxy++;
    }
    result.countries++;
    result.schools += ranked.length;
  }

  return result;
}

export function stats(): Record<string, number> {
  const d = getDb();
  const one = (sql: string): number => {
    const row = d.prepare(sql).get() as Record<string, unknown> | undefined;
    return Number(Object.values(row ?? {})[0] ?? 0);
  };
  return {
    jobsTotal: one("SELECT COUNT(*) FROM jobs"),
    jobsPe: one("SELECT COUNT(*) FROM jobs WHERE is_pe = 1"),
    jobsOpen: one("SELECT COUNT(*) FROM jobs WHERE is_pe = 1 AND status = 'open'"),
    jobsStale: one("SELECT COUNT(*) FROM jobs WHERE is_pe = 1 AND status = 'stale'"),
    jobsClosed: one("SELECT COUNT(*) FROM jobs WHERE is_pe = 1 AND status = 'closed'"),
    leadership: one(
      "SELECT COUNT(*) FROM jobs WHERE is_pe = 1 AND pe_seniority IN ('director_of_sport','head_of_department','second_in_department')",
    ),
    schools: one("SELECT COUNT(*) FROM schools"),
    schoolsEnriched: one("SELECT COUNT(*) FROM schools WHERE enriched_at IS NOT NULL"),
    schoolsWithCareerEmail: one("SELECT COUNT(*) FROM schools WHERE career_email IS NOT NULL"),
    runs: one("SELECT COUNT(*) FROM runs"),
  };
}

export function logDbPath(): void {
  log.debug(`database: ${DB_PATH}`);
}
