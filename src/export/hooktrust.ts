/**
 * Which scraped school facts are safe to put in a letter.
 *
 * A fact that appears word for word on two or more schools is not evidence
 * about any one of them. It is group boilerplate, a shared template, or a
 * pattern that misfired — "has been going since 1996" turned up on 24
 * schools, which cannot all be true. Saying it back to a school is the
 * fastest way to show the letter was not written for them, so a repeated fact
 * is treated as missing, and the letter falls back to something true or is
 * not written at all.
 *
 * Loaded once per process, like the other cross-school lookups in fields.ts;
 * `resetHookTrust` is for the watch loop.
 */

import { getSchools } from "../store/db.ts";

let shared: { school: Set<string>; pe: Set<string> } | null = null;

function repeated(values: (string | null)[]): Set<string> {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return new Set([...counts].filter(([, n]) => n > 1).map(([v]) => v));
}

function load(): { school: Set<string>; pe: Set<string> } {
  if (shared) return shared;
  const schools = [...getSchools().values()];
  shared = {
    school: repeated(schools.map((s) => s.school_hook)),
    pe: repeated(schools.map((s) => s.pe_hook)),
  };
  return shared;
}

/** The school fact if it is this school's alone, otherwise null. */
export function trustedSchoolHook(hook: string | null | undefined): string | null {
  return hook && !load().school.has(hook) ? hook : null;
}

/** The PE fact if it is this school's alone, otherwise null. */
export function trustedPeHook(hook: string | null | undefined): string | null {
  return hook && !load().pe.has(hook) ? hook : null;
}

export function resetHookTrust(): void {
  shared = null;
}
