/**
 * Names that have been checked by a person.
 *
 * Reading a principal's name off a web page by pattern can never be certain: a
 * menu heading is read as part of it, the next line of the page is read as a
 * surname, a deputy is read as the head. About a third of the names the
 * scraper had found were wrong in one of these ways. A wrong name in an
 * application is worse than none, so nothing the scraper reads is trusted: a
 * letter greets someone by name only when that name is in this file.
 *
 * Each entry says who, where it was confirmed and when. People change in July
 * and August, so an entry expires after nine months and the name must be
 * confirmed again before it is used.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface VerifiedName {
  name: string;
  /** YYYY-MM-DD the name was last confirmed. */
  verifiedOn: string;
  /** The page it was confirmed on. */
  source?: string;
}

export const VERIFIED_PATH = process.env.SCRAPPER_VERIFIED_NAMES || join(process.cwd(), "config", "verified-names.json");

/** A confirmation older than this is not trusted until it is renewed. */
export const VERIFIED_DAYS = 270;

interface FileShape {
  names?: Record<string, VerifiedName>;
}

let cache: Record<string, VerifiedName> | null = null;

export function loadVerified(path: string = VERIFIED_PATH): Record<string, VerifiedName> {
  if (path === VERIFIED_PATH && cache) return cache;
  let names: Record<string, VerifiedName> = {};
  if (existsSync(path)) {
    try {
      names = (JSON.parse(readFileSync(path, "utf8")) as FileShape).names ?? {};
    } catch {
      names = {};
    }
  }
  if (path === VERIFIED_PATH) cache = names;
  return names;
}

export function resetVerified(): void {
  cache = null;
}

/** The confirmed name for a school, only while the confirmation is current. */
export function verifiedFor(schoolKey: string | null | undefined, now = Date.now(), path: string = VERIFIED_PATH): VerifiedName | undefined {
  if (!schoolKey) return undefined;
  const v = loadVerified(path)[schoolKey];
  if (!v?.name?.trim()) return undefined;
  const on = Date.parse(v.verifiedOn);
  if (Number.isNaN(on) || now - on > VERIFIED_DAYS * 86_400_000) return undefined;
  return v;
}

/** An expired entry still says who was confirmed last time, which is worth showing. */
export function expiredFor(schoolKey: string | null | undefined, path: string = VERIFIED_PATH): VerifiedName | undefined {
  const v = schoolKey ? loadVerified(path)[schoolKey] : undefined;
  return v && !verifiedFor(schoolKey, Date.now(), path) ? v : undefined;
}

function write(names: Record<string, VerifiedName>, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const sorted = Object.fromEntries(Object.entries(names).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(
    path,
    JSON.stringify(
      {
        "//": "Principals' names a person has checked on the school's own page. A letter greets someone by name only if they are here. See src/export/verifiednames.ts.",
        names: sorted,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  if (path === VERIFIED_PATH) cache = null;
}

export function recordVerified(schoolKey: string, name: string, source?: string, path: string = VERIFIED_PATH): VerifiedName {
  const names = { ...loadVerified(path) };
  const entry: VerifiedName = { name: name.trim(), verifiedOn: new Date().toISOString().slice(0, 10), ...(source ? { source } : {}) };
  names[schoolKey] = entry;
  write(names, path);
  return entry;
}

export function forgetVerified(schoolKey: string, path: string = VERIFIED_PATH): boolean {
  const names = { ...loadVerified(path) };
  if (!(schoolKey in names)) return false;
  delete names[schoolKey];
  write(names, path);
  return true;
}
