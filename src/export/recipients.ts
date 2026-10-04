/**
 * Turns the schools table into the thing you actually send: one row per
 * recipient address, never one per school.
 *
 * Two problems this exists to solve, both found by looking at the real data
 * rather than assuming the schema already prevented them:
 *
 *  1. 66 addresses in the database are shared by two or more schools — a
 *     group careers inbox, a regional HR contact. Treating each school as its
 *     own row would write that one inbox several separate "letters", each
 *     claiming to be specifically about a different campus. That is not a
 *     personalisation bug, it is proof of a mail-merge blast to the one
 *     person positioned to notice.
 *
 *  2. 59% of the prose "school hooks" this codebase extracts turn out to be
 *     boilerplate shared across many schools — "has been going since 1996"
 *     appeared on 24 of them, which cannot all be true. A hook that reads as
 *     specific but is actually generic is worse than an honestly generic
 *     sentence, because it is the one a recipient is most likely to check.
 *     So a hook seen on more than one school is never trusted here; it falls
 *     back to the structured facts (accreditation, curriculum, roll) that are
 *     unimpressive but true.
 */

import type { SchoolRow } from "../store/db.ts";
import { groupSpeculativeEmail, schoolFact, speculativeEmail } from "./email.ts";
import { loadSentLog, monthsSinceSent, type SentRecord } from "../sentlog.ts";

export type RecipientTier = "careers" | "named" | "general";
export type FactQuality = "unique" | "structured" | "none" | "group";

export interface Recipient {
  email: string;
  tier: RecipientTier;
  schools: SchoolRow[];
  country: string | null;
  city: string | null;
  /** Best (lowest) country_rank across the schools this address covers. */
  rank: number | null;
  contactName: string | null;
  factQuality: FactQuality;
  subject: string;
  body: string;
  /** Non-empty only when no letter could be written at all. */
  missing: string[];
  lastSent: SentRecord | undefined;
  monthsSinceSent: number | null;
}

/** The one address to write to for a school, in the order a careers address beats everything else. */
function resolveAddress(s: SchoolRow): { email: string; tier: RecipientTier } | null {
  if (s.career_email) return { email: s.career_email, tier: "careers" };
  if (s.contact_email) return { email: s.contact_email, tier: "named" };
  if (s.school_email) return { email: s.school_email, tier: "general" };
  return null;
}

/** A hook seen on 2+ schools is boilerplate, not a fact about any one of them. */
function findSharedHooks(schools: SchoolRow[]): Set<string> {
  const counts = new Map<string, number>();
  for (const s of schools) {
    if (!s.school_hook) continue;
    counts.set(s.school_hook, (counts.get(s.school_hook) ?? 0) + 1);
  }
  const shared = new Set<string>();
  for (const [hook, n] of counts) if (n > 1) shared.add(hook);
  return shared;
}

function commonValue<T>(values: (T | null)[]): T | null {
  const unique = new Set(values.filter((v): v is T => v != null));
  return unique.size === 1 ? [...unique][0]! : null;
}

export function buildRecipients(allSchools: SchoolRow[], sentLogPath?: string): Recipient[] {
  const sentLog = loadSentLog(sentLogPath);
  const sharedHooks = findSharedHooks(allSchools);

  const groups = new Map<string, { tier: RecipientTier; schools: SchoolRow[] }>();
  for (const s of allSchools) {
    const resolved = resolveAddress(s);
    if (!resolved) continue;
    const key = resolved.email.toLowerCase();
    const g = groups.get(key);
    if (g) {
      g.schools.push(s);
      // A careers address beats a name beats a general one, no matter which
      // school happened to be read first.
      const rank: Record<RecipientTier, number> = { careers: 0, named: 1, general: 2 };
      if (rank[resolved.tier] < rank[g.tier]) g.tier = resolved.tier;
    } else {
      groups.set(key, { tier: resolved.tier, schools: [s] });
    }
  }

  const recipients: Recipient[] = [];
  for (const [email, { tier, schools }] of groups) {
    const rank = schools.reduce<number | null>(
      (best, s) => (s.country_rank != null && (best == null || s.country_rank < best) ? s.country_rank : best),
      null,
    );
    const rec = sentLog.get(email);
    const base = {
      email,
      tier,
      schools,
      country: commonValue(schools.map((s) => s.country)) ?? (schools.length > 1 ? "Multiple" : null),
      city: commonValue(schools.map((s) => s.city)),
      rank,
      lastSent: rec,
      monthsSinceSent: monthsSinceSent(rec),
    };

    if (schools.length > 1) {
      const draft = groupSpeculativeEmail({
        schools: schools.map((s) => s.name),
        country: commonValue(schools.map((s) => s.country)),
        city: commonValue(schools.map((s) => s.city)),
      });
      recipients.push({
        ...base,
        contactName: null,
        factQuality: "group",
        subject: draft.subject,
        body: draft.body,
        missing: draft.missing,
      });
      continue;
    }

    const s = schools[0]!;
    const hookIsTrustworthy = !!s.school_hook && !sharedHooks.has(s.school_hook);
    const draft = speculativeEmail({
      school: s.name,
      principal: s.contact_name || s.principal,
      schoolHook: hookIsTrustworthy ? s.school_hook : null,
      peHook: s.pe_hook,
      accreditation: s.accreditation,
      curriculum: s.curriculum_json ? (JSON.parse(s.curriculum_json) as string[]) : null,
      studentCount: s.student_count,
    });

    const fact = schoolFact({
      school: s.name,
      schoolHook: hookIsTrustworthy ? s.school_hook : null,
      accreditation: s.accreditation,
      curriculum: s.curriculum_json ? (JSON.parse(s.curriculum_json) as string[]) : null,
      studentCount: s.student_count,
    });
    const factQuality: FactQuality = !fact ? "none" : hookIsTrustworthy ? "unique" : "structured";

    recipients.push({
      ...base,
      contactName: s.contact_name || s.principal,
      factQuality,
      subject: draft.subject,
      body: draft.body,
      missing: draft.missing,
    });
  }

  return recipients;
}
