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
import { groupSpeculativeEmail, speculativeEmail } from "./email.ts";
import { trustedPeHook, trustedSchoolHook } from "./hooktrust.ts";
import { principalFor } from "./factsource.ts";
import { ledgerState } from "../ledger.ts";
import { loadSentLog, monthsSinceSent, type SentRecord } from "../sentlog.ts";

export type RecipientTier = "careers" | "named" | "general";
/** unique: a fact held for this school alone. none: the letter is written without a hook. group: a shared inbox. */
export type FactQuality = "unique" | "none" | "group";

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
  /** Things to check before sending; never part of the body. */
  flags: string[];
  /** Positions already applied for at these schools, from the permanent record. */
  applications: { at: string; title: string; school: string }[];
  /** Roles at these schools you decided against. */
  skippedCount: number;
  /** Applied within the last 60 days — a speculative email now would cross it. */
  appliedRecently: boolean;
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

function commonValue<T>(values: (T | null)[]): T | null {
  const unique = new Set(values.filter((v): v is T => v != null));
  return unique.size === 1 ? [...unique][0]! : null;
}

export function buildRecipients(allSchools: SchoolRow[], sentLogPath?: string): Recipient[] {
  const sentLog = loadSentLog(sentLogPath);
  const decided = ledgerState();
  const RECENT_DAYS = 60;

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
    const keys = new Set(schools.map((s) => s.school_key));
    const applications = [...decided.applied.values()]
      .filter((e) => e.school_key && keys.has(e.school_key))
      .map((e) => ({ at: e.at, title: e.title, school: e.school ?? "" }));
    const skippedCount = [...decided.skipped.values()].filter((e) => e.school_key && keys.has(e.school_key)).length;
    const appliedRecently = applications.some((a) => Date.now() - Date.parse(a.at) < RECENT_DAYS * 86_400_000);
    const history = { applications, skippedCount, appliedRecently };
    const base = {
      ...history,
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
        flags: draft.flags,
      });
      continue;
    }

    const s = schools[0]!;
    const schoolHook = trustedSchoolHook(s.school_hook);
    const peHook = trustedPeHook(s.pe_hook);
    const draft = speculativeEmail({
      school: s.name,
      // Only the principal is greeted by name. A Director of Sport or an HR
      // contact is somebody to write TO, not somebody to call "Principal".
      ...principalFor(s),
      schoolHook,
      peHook,
      curriculum: s.curriculum_json ? (JSON.parse(s.curriculum_json) as string[]) : null,
    });

    recipients.push({
      ...base,
      contactName: s.contact_name || s.principal,
      factQuality: schoolHook || peHook ? "unique" : "none",
      subject: draft.subject,
      body: draft.body,
      missing: draft.missing,
      flags: draft.flags,
    });
  }

  return recipients;
}
