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


/*
 * A stored fact is only said back to a school when it has one of the shapes the extractor is meant
 * to produce, and ends where the sentence ends. Older runs stored fragments ("is IB World School
 * for more than 30 years and during this time we have develop", "became the first school in
 * Morocco to offer a program following Dr") that read as broken English in a letter, so anything
 * outside these shapes is treated as missing and the letter falls back to the line about me.
 */
const JOINER = /\b(?:as|a|an|the|of|and|or|to|in|for|with|at|by|on|from|that|which|is|are|such|its|their|our|we|following)\s*$/i;

function cleanSchool(h: string): string | null {
  const t = h.trim();
  if (/^is (?:an )?IB World School\b/i.test(t)) return "is an IB World School";
  if (/^was (?:founded|established) in (?:18|19|20)\d{2}$/.test(t)) return t;
  if (t.length > 100 || JOINER.test(t) || /[.!?]\s/.test(t) || /\b(?:we|our|us|I)\b/.test(t)) return null;
  if (/^is accredited by [A-Za-z][A-Za-z&'’, -]{2,80}$/.test(t)) return t;
  if (/^is an? [a-z][a-z, '’-]{2,80} school$/.test(t)) return t;
  if (/^teaches students (?:from|aged?) [A-Za-z0-9 ,'’.-]{3,45}$/.test(t)) return t;
  return null;
}

const SPORT = /^(?:football|soccer|basketball|netball|rugby|cricket|tennis|volleyball|badminton|hockey|athletics|gymnastics|golf|rowing|swimming|baseball|softball|squash|handball|futsal|sailing|climbing|dance|judo|karate|taekwondo|archery|cycling|skiing|triathlon|water polo|table tennis|cross country|track and field)$/i;

function cleanPe(h: string): string | null {
  const t = h.trim();
  if (JOINER.test(t) || /\b(?:we|our|us|I)\b/.test(t)) return null;
  if (/^the [a-z][a-z -]{2,40}$/.test(t)) return t;
  if (/^competing in (?:the )?[A-Z][A-Za-z&'’ -]{3,70}$/.test(t)) return t;
  const m = /^your sports programme covering (.+)$/.exec(t);
  if (m) {
    const items = m[1]!.split(/,\s*|\s+(?:and|or)\s+/).map((x) => x.trim()).filter(Boolean);
    return items.length && items.every((x) => SPORT.test(x)) ? t : null;
  }
  return null;
}

/** The school fact if it is this school's alone, otherwise null. */
export function trustedSchoolHook(hook: string | null | undefined): string | null {
  return hook && !load().school.has(hook) ? cleanSchool(hook) : null;
}

/** The PE fact if it is this school's alone, otherwise null. */
export function trustedPeHook(hook: string | null | undefined): string | null {
  return hook && !load().pe.has(hook) ? cleanPe(hook) : null;
}

export function resetHookTrust(): void {
  shared = null;
}
