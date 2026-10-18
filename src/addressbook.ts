/**
 * Every email address ever seen for a school. Nothing is removed from it.
 *
 * Why it exists: the database keeps one "best" school address and one careers
 * address per school, and a fresh crawl that finds anything replaces the lot.
 * That is right for choosing who to write to today and wrong as a record: an
 * address that is not the best one is still a way in. A letter sent to the
 * admissions inbox gets forwarded to the right desk, and a recruitment address
 * the next crawl failed to re-find is still a recruitment address. Auditing
 * the committed database history found 5,806 addresses that had been dropped
 * this way across 1,462 schools.
 *
 * So this is its own append-only file, like the sent log and for the same
 * reason: nothing else touches it, so nothing can clobber it. A line is
 * written the first time an address is seen for a school, and never edited or
 * deleted. Tracked in git, so it also survives a rebuilt database.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface AddressRecord {
  /** school_key */
  k: string;
  /** the address, lower-cased */
  e: string;
  /** where it was seen: a column or list name, or a historical database */
  w: string;
  /** the day it was first recorded */
  d: string;
}

export const ADDRESS_BOOK_PATH = process.env.SCRAPPER_ADDRESS_BOOK || join(process.cwd(), "data", "address-book.jsonl");

const EMAIL_OK = /^[^@\s,;<>()"']+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

/** Things that look like an address and are not one: image names, template placeholders. */
const NOT_AN_ADDRESS = /\.(png|jpe?g|gif|webp|svg|css|js)$|@(2x|3x)\b|example\.|yourdomain|domain\.com|email\.com|sentry|wixpress|mysite\.com/i;

let cache: { path: string; byKey: Map<string, Map<string, AddressRecord>> } | null = null;

export function loadAddressBook(path: string = ADDRESS_BOOK_PATH): Map<string, Map<string, AddressRecord>> {
  if (cache && cache.path === path) return cache.byKey;
  const byKey = new Map<string, Map<string, AddressRecord>>();
  if (existsSync(path)) {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        const r = JSON.parse(t) as AddressRecord;
        if (!r.k || !r.e) continue;
        const m = byKey.get(r.k) ?? new Map<string, AddressRecord>();
        if (!m.has(r.e)) m.set(r.e, r);
        byKey.set(r.k, m);
      } catch {
        // A damaged line must not take the book down.
      }
    }
  }
  cache = { path, byKey };
  return byKey;
}

export function resetAddressBook(): void {
  cache = null;
}

/** Every address on file for a school, in the order first seen. */
export function addressesFor(schoolKey: string, path?: string): AddressRecord[] {
  return [...(loadAddressBook(path).get(schoolKey)?.values() ?? [])];
}

/**
 * Record addresses for a school. Only ones not already in the book are written,
 * so calling this on every enrichment adds nothing but what is new.
 */
export function recordAddresses(
  schoolKey: string,
  addresses: (string | null | undefined)[],
  where: string,
  path: string = ADDRESS_BOOK_PATH,
): number {
  const book = loadAddressBook(path);
  const have = book.get(schoolKey) ?? new Map<string, AddressRecord>();
  const day = new Date().toISOString().slice(0, 10);
  const fresh: AddressRecord[] = [];
  for (const raw of addresses) {
    const e = raw?.trim().toLowerCase();
    if (!e || !EMAIL_OK.test(e) || NOT_AN_ADDRESS.test(e) || have.has(e)) continue;
    const rec = { k: schoolKey, e, w: where, d: day };
    have.set(e, rec);
    fresh.push(rec);
  }
  if (!fresh.length) return 0;
  book.set(schoolKey, have);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, fresh.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  return fresh.length;
}

// ---------------------------------------------------------------------------
// Recovering what was dropped before the book existed.
// ---------------------------------------------------------------------------

const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/** Read every address out of one database file and add the new ones to the book. */
export async function backfillFromDb(dbPath: string, label: string): Promise<number> {
  const { DatabaseSync } = await import("node:sqlite");
  const d = new DatabaseSync(dbPath, { readOnly: true });
  let added = 0;
  try {
    const cols = (d.prepare("PRAGMA table_info(schools)").all() as { name: string }[]).map((c) => c.name);
    const wanted = ["school_email", "career_email", "contact_email", "emails_json"].filter((c) => cols.includes(c));
    for (const r of d.prepare(`SELECT school_key, ${wanted.join(", ")} FROM schools`).all() as Record<string, unknown>[]) {
      const found: string[] = [];
      for (const c of wanted) {
        const v = r[c];
        if (typeof v !== "string") continue;
        if (c === "emails_json") for (const m of v.matchAll(EMAIL_IN_TEXT)) found.push(m[0]);
        else found.push(v);
      }
      added += recordAddresses(r.school_key as string, found, label);
    }
  } finally {
    d.close();
  }
  return added;
}

/** Replay every committed version of data/jobs.db, oldest first, so nothing that was ever stored is lost. */
export async function backfillFromGitHistory(ref = "origin/main"): Promise<{ versions: number; added: number }> {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const commits = execFileSync("git", ["log", ref, "--format=%h", "--reverse", "--", "data/jobs.db"], { encoding: "utf8" })
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const dir = mkdtempSync(join(tmpdir(), "addrbook-"));
  let added = 0;
  try {
    for (const c of commits) {
      try {
        const bytes = execFileSync("git", ["show", `${c}:data/jobs.db`], { maxBuffer: 512 * 1024 * 1024 });
        const file = join(dir, `${c}.db`);
        writeFileSync(file, bytes);
        added += await backfillFromDb(file, `history ${c}`);
        rmSync(file, { force: true });
      } catch {
        // A commit whose database cannot be read is skipped; the rest still count.
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return { versions: commits.length, added };
}

export function addressBookStatus(path: string = ADDRESS_BOOK_PATH): { schools: number; addresses: number } {
  const book = loadAddressBook(path);
  let addresses = 0;
  for (const m of book.values()) addresses += m.size;
  return { schools: book.size, addresses };
}
