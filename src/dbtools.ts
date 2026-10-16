/**
 * Keeping the database for the long term.
 *
 * Two copies of data/jobs.db exist in practice: the one on this computer, with
 * everything enriched by hand-run crawls, and the one on GitHub, rewritten by
 * the scheduled scrapes every day. A binary file cannot be merged by git, so
 * whichever is pushed last silently wins and the other's work is lost.
 *
 *   backup   a consistent, timestamped copy (VACUUM INTO — includes the WAL, so
 *            nothing recent is missing the way a plain file copy would be)
 *   merge    fold another jobs.db into this one without losing either side
 *   sync     fetch GitHub's database and merge it into this one
 *   status   what is in it
 *
 * Merge rules, per row: the fresher record is the base and the other fills any
 * field the base leaves empty. Your own tracking (applied / not interested /
 * notes) is never overwritten by a blank. Runs and sightings are not merged:
 * their ids restart in each copy, so the same number means different things.
 */

import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "./core/logger.ts";
import { DB_PATH } from "./store/db.ts";

const BACKUP_DIR = join(process.cwd(), "backups");
const KEEP_BACKUPS = 30;

type Row = Record<string, unknown>;
const empty = (v: unknown): boolean => v === null || v === undefined || v === "";

const time = (v: unknown): number => {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

export function backupDb(label = "manual"): string {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
  const out = join(BACKUP_DIR, `jobs-${stamp}-${label}.db`);
  if (existsSync(out)) unlinkSync(out);
  const d = new DatabaseSync(DB_PATH);
  d.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
  d.close();

  const check = new DatabaseSync(out, { readOnly: true });
  const ok = (check.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check === "ok";
  check.close();
  if (!ok) throw new Error(`backup ${out} failed its integrity check`);

  // Keep the newest few; the one just made is always among them.
  const old = readdirSync(BACKUP_DIR)
    .filter((f) => /^jobs-.*\.db$/.test(f))
    .map((f) => ({ f, t: statSync(join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
    .slice(KEEP_BACKUPS);
  for (const { f } of old) unlinkSync(join(BACKUP_DIR, f));
  log.ok(`backup → ${out}`);
  return out;
}

/** The fresher of two rows is the base; the other only fills its blanks. */
function blend(a: Row, b: Row, freshness: (r: Row) => number, cols: string[]): Row {
  const [base, other] = freshness(a) >= freshness(b) ? [a, b] : [b, a];
  const out: Row = {};
  for (const c of cols) out[c] = empty(base[c]) ? (other[c] ?? null) : base[c];
  return out;
}

export interface MergeSummary {
  schoolsAdded: number;
  schoolsUpdated: number;
  jobsAdded: number;
  jobsUpdated: number;
}

export function mergeDb(otherPath: string): MergeSummary {
  if (!existsSync(otherPath)) throw new Error(`no such file: ${otherPath}`);
  backupDb("before-merge");

  const local = new DatabaseSync(DB_PATH);
  const other = new DatabaseSync(otherPath, { readOnly: true });
  const sum: MergeSummary = { schoolsAdded: 0, schoolsUpdated: 0, jobsAdded: 0, jobsUpdated: 0 };

  const columns = (db: DatabaseSync, table: string): string[] =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  const shared = (table: string): string[] => {
    const theirs = new Set(columns(other, table));
    return columns(local, table).filter((c) => theirs.has(c));
  };

  const upsert = (table: string, cols: string[], row: Row): void => {
    const marks = cols.map(() => "?").join(", ");
    local
      .prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) VALUES (${marks})`)
      .run(...(cols.map((c) => row[c] ?? null) as never[]));
  };
  const changed = (cols: string[], next: Row, prev: Row): boolean => cols.some((c) => (next[c] ?? null) !== (prev[c] ?? null));

  local.exec("BEGIN");
  try {
    // ---- schools: a profile is as fresh as its last enrichment ------------
    const sCols = shared("schools");
    const mine = new Map((local.prepare("SELECT * FROM schools").all() as Row[]).map((r) => [r.school_key as string, r]));
    for (const theirs of other.prepare("SELECT * FROM schools").all() as Row[]) {
      const have = mine.get(theirs.school_key as string);
      if (!have) {
        upsert("schools", sCols, theirs);
        sum.schoolsAdded++;
        continue;
      }
      const merged = blend(have, theirs, (r) => time(r.enriched_at), sCols);
      if (changed(sCols, merged, have)) {
        upsert("schools", sCols, merged);
        sum.schoolsUpdated++;
      }
    }

    // ---- jobs: as fresh as the last time the advert was seen --------------
    const jCols = shared("jobs");
    const myJobs = new Map((local.prepare("SELECT * FROM jobs").all() as Row[]).map((r) => [r.id as string, r]));
    for (const theirs of other.prepare("SELECT * FROM jobs").all() as Row[]) {
      const have = myJobs.get(theirs.id as string);
      if (!have) {
        upsert("jobs", jCols, theirs);
        sum.jobsAdded++;
        continue;
      }
      const merged = blend(have, theirs, (r) => time(r.last_seen_at), jCols);
      const firsts = [have.first_seen_at, theirs.first_seen_at].filter((v) => !empty(v)) as string[];
      if (firsts.length) merged.first_seen_at = firsts.sort()[0];

      // Your own status comes from whichever copy set it last, and a blank never wins.
      const mineWins = time(have.my_status_at) >= time(theirs.my_status_at);
      const src = mineWins ? have : theirs;
      if (!empty(src.my_status)) {
        merged.my_status = src.my_status;
        merged.my_status_at = src.my_status_at ?? null;
      }
      if (empty(merged.my_note)) merged.my_note = have.my_note ?? theirs.my_note ?? null;

      if (changed(jCols, merged, have)) {
        upsert("jobs", jCols, merged);
        sum.jobsUpdated++;
      }
    }

    // ---- website attempts: the newest try per school ----------------------
    const aCols = ["school_key", "at", "found"];
    const attempts = new Map(
      (local.prepare("SELECT * FROM website_attempts").all() as Row[]).map((r) => [r.school_key as string, r]),
    );
    for (const theirs of other.prepare("SELECT * FROM website_attempts").all() as Row[]) {
      const have = attempts.get(theirs.school_key as string);
      if (!have || time(theirs.at) > time(have.at)) upsert("website_attempts", aCols, theirs);
    }

    local.exec("COMMIT");
  } catch (err) {
    local.exec("ROLLBACK");
    throw err;
  } finally {
    local.close();
    other.close();
  }
  return sum;
}

/** GitHub's copy of the database, merged into this one. */
export function syncFromGitHub(): MergeSummary {
  execFileSync("git", ["fetch", "-q", "origin"], { stdio: "inherit" });
  mkdirSync(BACKUP_DIR, { recursive: true });
  const tmp = join(BACKUP_DIR, "_github-jobs.db");
  const bytes = execFileSync("git", ["show", "origin/main:data/jobs.db"], { maxBuffer: 512 * 1024 * 1024 });
  writeFileSync(tmp, bytes);
  try {
    return mergeDb(tmp);
  } finally {
    unlinkSync(tmp);
  }
}

export function dbStatus(): Record<string, number> {
  const d = new DatabaseSync(DB_PATH, { readOnly: true });
  const one = (sql: string): number => Number((d.prepare(sql).get() as Row)["c"]);
  const out = {
    schools: one("SELECT COUNT(*) c FROM schools"),
    withCareersEmail: one("SELECT COUNT(*) c FROM schools WHERE career_email IS NOT NULL"),
    withAnyEmail: one(
      "SELECT COUNT(*) c FROM schools WHERE career_email IS NOT NULL OR school_email IS NOT NULL OR contact_email IS NOT NULL",
    ),
    withWebsite: one("SELECT COUNT(*) c FROM schools WHERE website IS NOT NULL"),
    enriched: one("SELECT COUNT(*) c FROM schools WHERE enriched_at IS NOT NULL"),
    jobs: one("SELECT COUNT(*) c FROM jobs"),
    openPeJobs: one("SELECT COUNT(*) c FROM jobs WHERE is_pe = 1 AND status = 'open'"),
    myMarkedJobs: one("SELECT COUNT(*) c FROM jobs WHERE my_status IS NOT NULL"),
  };
  d.close();
  return out;
}
