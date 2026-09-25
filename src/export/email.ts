/**
 * The prepared application email.
 *
 * Built strictly from the school's own website and your profile. The rule that
 * shapes this file: **if a personal detail cannot be found, say so rather than
 * invent one**. A plausible-sounding but wrong Principal's name, or a
 * compliment about a facility the school does not have, is worse than no
 * email at all — it is the kind of mistake that ends an application.
 *
 * So a row either carries a complete email, or it carries a short note saying
 * exactly which detail is missing and where to look.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../core/logger.ts";
import type { Qualification } from "../core/types.ts";
import { assessFit, fitSentence } from "../match/fit.ts";

export interface Profile {
  name: string;
  website: string;
  websiteLabel: string;
  signOff: string;
  openingLine: string;
  /** Used for the top-schools list, where there is no vacancy to name. */
  speculativeOpening?: string;
  speculativeClosing?: string;
  qualifications?: Qualification[];
  strengths: { when?: string; text: string }[];
  closing: string;
}

export interface EmailInputs {
  role: string;
  school: string;
  /** Title and full name, e.g. "Mr Myles Jackson". */
  principal?: string | null;
  schoolHook?: string | null;
  peHook?: string | null;
  /** The advert text, used to name the requirements you actually meet. */
  advertText?: string | null;
}

export interface DraftEmail {
  /** The finished message, or "" when something is missing. */
  body: string;
  subject: string;
  /** Detail names that could not be found. Empty means the email is complete. */
  missing: string[];
}

let cached: Profile | null = null;

export function loadProfile(): Profile | null {
  if (cached) return cached;
  const path = join(process.cwd(), "config", "profile.json");
  if (!existsSync(path)) return null;
  try {
    cached = JSON.parse(readFileSync(path, "utf8")) as Profile;
    return cached;
  } catch (err) {
    log.warn(`could not read ${path}: ${(err as Error).message}`);
    return null;
  }
}

export function resetProfile(): void {
  cached = null;
}

/** Pick the paragraph whose trigger matches what their PE page talks about. */
function chooseStrength(profile: Profile, peHook: string): string {
  for (const s of profile.strengths) {
    if (!s.when) continue;
    try {
      if (new RegExp(s.when, "i").test(peHook)) return s.text;
    } catch {
      /* a bad pattern in config should not break the email */
    }
  }
  // The entry without a `when` is the fallback.
  return profile.strengths.find((s) => !s.when)?.text ?? profile.strengths[0]?.text ?? "";
}

/** "Crescendo-HELP International School" -> "CHIS" is not safe to guess, so
 *  the full name is used unless it is very long. */
function shortName(school: string): string {
  return school.length <= 40 ? school : school.split(/[,(–-]/)[0]!.trim();
}

const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? `{${k}}`);

/**
 * Acronyms that must stay shouting when a title is tidied. Anything else that
 * is short and has no vowels — SNA, HCMC, KDU — is almost certainly a school
 * or city code, so it keeps its capitals too.
 */
const KEEP_CAPS = new Set([
  "IB", "PE", "PYP", "MYP", "DP", "AP", "IGCSE", "GCSE", "EAL", "ESL", "ICT",
  "STEM", "SEN", "HOD", "EYFS", "KS1", "KS2", "KS3", "KS4", "KS5", "US", "UK",
  "USA", "UAE", "HR", "PHE", "HPE", "CCA", "ECA", "SNA", "MYP/DP",
]);

/**
 * Boards often shout a job title — "PHYSICAL EDUCATION TEACHER - SNA IB HCMC".
 * Pasted straight into a letter that reads as careless, which is the opposite
 * of what a personalised application is for. Only fully-shouted titles are
 * touched; anything already mixed-case is left exactly as the school wrote it.
 */
/** Connectors that stay lowercase inside a title: "Head of PE", not "Head Of PE". */
const LOWER_IN_TITLE = new Set(["of", "and", "the", "for", "in", "at", "to", "a", "an", "or"]);

export function tidyRole(role: string): string {
  const letters = role.replace(/[^A-Za-z]/g, "");
  if (!letters || letters !== letters.toUpperCase()) return role.trim();

  let seenWord = false;
  return role
    .trim()
    .split(/(\s+|[-–/])/)
    .map((word) => {
      if (!/[A-Za-z]/.test(word)) return word;
      const bare = word.replace(/[^A-Za-z0-9]/g, "");
      const first = !seenWord;
      seenWord = true;

      if (KEEP_CAPS.has(bare)) return word;
      // No vowels and short: a code, not a word.
      if (bare.length <= 5 && !/[AEIOU]/.test(bare)) return word;
      if (!first && LOWER_IN_TITLE.has(bare.toLowerCase())) return word.toLowerCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join("");
}

export function draftEmail(inputs: EmailInputs): DraftEmail {
  const profile = loadProfile();
  if (!profile) {
    return { body: "", subject: "", missing: ["config/profile.json is missing"] };
  }

  /*
   * The two hooks are the substance of the letter — they are the reason it
   * reads as written for this school rather than posted to fifty. Without
   * them there is nothing worth sending, so the email is not written.
   *
   * The head's name is different. It is a salutation, not a claim about the
   * school, and it is published by only about one school in fourteen. Blocking
   * on it threw away every otherwise-complete draft. So the letter is written
   * with the gap left open in the greeting itself, where it cannot be missed
   * and cannot be sent by accident. Nothing is invented either way.
   */
  const missing: string[] = [];
  if (!inputs.schoolHook) missing.push("school fact");
  if (!inputs.peHook) missing.push("PE/sport fact");

  const role = tidyRole(inputs.role);
  const subject = `Application for ${role}, ${profile.name}`;

  if (missing.length) {
    // Report the name too, so the cell lists everything still to find.
    return {
      body: "",
      subject,
      missing: inputs.principal ? missing : [...missing, "principal name"],
    };
  }

  const greeting = inputs.principal ?? "[add the head's name — not published]";

  const values = {
    role,
    school: inputs.school,
    shortSchool: shortName(inputs.school),
  };

  // What the advert asks for that you can evidence, in their order of asking.
  const fit = assessFit(inputs.advertText ?? "", profile.qualifications ?? []);
  const sentence = fitSentence(fit);
  const fitLine = sentence
    ? `You ask for ${fit.signals.slice(0, 3).map((s) => s.requirement).join(", ")}: ${sentence}.`
    : "";

  const body = [
    `Dear ${greeting} and the HR Team,`,
    "",
    fill(profile.openingLine, values),
    "",
    `What first caught my attention is that ${inputs.school} ${inputs.schoolHook}. ` +
      `That says a lot about a school that takes learning seriously, which is exactly how I approach PE.`,
    "",
    `I also like ${inputs.peHook}. A school that treats sport as part of a well-rounded ` +
      `education is a school where every student can find their own motivation to move.`,
    "",
    `That is what I would bring to your PE department. ${chooseStrength(profile, inputs.peHook!)}`,
    "",
    // Named only when the advert actually asks for it and the profile claims
    // it. Listing a strength nobody asked for reads as padding.
    ...(fitLine ? [fitLine, ""] : []),
    `You can find my CV and examples of my work on ${profile.websiteLabel}: ${profile.website}`,
    "",
    fill(profile.closing, values),
    "",
    `${profile.signOff},`,
    profile.name,
  ].join("\n");

  return { body, subject, missing: [] };
}

/**
 * What goes in the spreadsheet cell: the email, or a note naming the gaps.
 * Phrased as an instruction so the cell is actionable rather than just empty.
 */
export interface SpeculativeInputs {
  school: string;
  principal?: string | null;
  /** A sentence about the school, read from its own pages. */
  schoolHook?: string | null;
  /** Something concrete about their sport, if the crawl found any. */
  peHook?: string | null;
  /** Verified facts held about the school, used when no prose hook exists. */
  accreditation?: string | null;
  curriculum?: string[] | null;
  studentCount?: number | null;
}

/**
 * Turn the facts we hold into a sentence that is true and specific.
 *
 * A prose hook read from the school's own pages is best, but only one school
 * in ten has one. What far more have is structured and equally real —
 * accreditation, curriculum, roll — and saying "you are accredited by CIS and
 * IB" is neither invented nor generic. It is the difference between writing to
 * 130 schools and writing to 52.
 *
 * Returns nothing when there is no fact at all, because a letter that says
 * only "I admire your school" is a form letter, and those are what this column
 * exists to avoid.
 */
/** ["CIS","WASC","IB"] -> "CIS, WASC and IB". */
function andList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function schoolFact(i: SpeculativeInputs): string | null {
  if (i.schoolHook) return `${i.school} ${i.schoolHook}`;

  const parts: string[] = [];
  if (i.accreditation) {
    // Stored as "CIS, WASC"; written out it needs to read as a list, or the
    // clause that follows gets swallowed into it.
    parts.push(`your accreditation with ${andList(i.accreditation.split(/\s*,\s*/).filter(Boolean))}`);
  }
  const cur = i.curriculum?.filter(Boolean).slice(0, 3) ?? [];
  if (cur.length) parts.push(`the ${andList(cur)} programme${cur.length > 1 ? "s" : ""} you run`);
  if (i.studentCount && i.studentCount >= 100) {
    parts.push(`a school of around ${i.studentCount.toLocaleString("en-GB")} students`);
  }
  if (!parts.length) return null;

  // Each part is itself a list, so the parts are separated with ", and " —
  // otherwise "accreditation with CIS, WASC and the American programme" reads
  // as though the programme were a third accrediting body.
  const joined =
    parts.length > 1 ? `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}` : parts[0]!;
  return `what stands out about ${i.school} is ${joined}`;
}

/**
 * A letter to a school that is not advertising.
 *
 * Most international appointments are made before a vacancy is published, and
 * the top-schools list exists precisely to reach those schools early — so this
 * is arguably the more valuable of the two letters. It differs from the job
 * version in what it can claim: there is no role to name and no advert to
 * answer, so the personalisation rests entirely on what is known about the
 * school, and the ask is to be remembered rather than considered.
 *
 * The same rule governs it: every detail is real, or the letter is not written.
 */
export function speculativeEmail(i: SpeculativeInputs): DraftEmail {
  const profile = loadProfile();
  if (!profile) return { body: "", subject: "", missing: ["config/profile.json is missing"] };

  const fact = schoolFact(i);
  const subject = `Physical Education — speculative enquiry, ${profile.name}`;
  if (!fact) return { body: "", subject, missing: ["something specific about the school"] };

  const values = { school: i.school, shortSchool: shortName(i.school), role: "Physical Education" };
  const greeting = i.principal ?? "[add the head's name — not published]";

  const body = [
    `Dear ${greeting} and the HR Team,`,
    "",
    fill(profile.speculativeOpening ?? profile.openingLine, values),
    "",
    `${fact[0]!.toUpperCase()}${fact.slice(1)}. That is the kind of school where I would want to build a PE department, rather than simply teach in one.`,
    "",
    // Only when the crawl actually found something about their sport. Without
    // it the letter stays about the school, which is still specific.
    ...(i.peHook
      ? [
          `I also like ${i.peHook}. A school that treats sport as part of a well-rounded ` +
            `education is a school where every student can find their own motivation to move.`,
          "",
        ]
      : []),
    chooseStrength(profile, i.peHook ?? ""),
    "",
    `You can find my CV and examples of my work on ${profile.websiteLabel}: ${profile.website}`,
    "",
    fill(profile.speculativeClosing ?? profile.closing, values),
    "",
    `${profile.signOff},`,
    profile.name,
  ].join("\n");

  return { body, subject, missing: [] };
}

/**
 * The cell for the Prepared Email column.
 *
 * When a detail is missing the email is not written, on purpose — a
 * half-personalised approach is worse than none. What the cell owes you in
 * that case is somewhere to go, so it names the school's website: that is the
 * one place every missing detail can actually be found, and it turns the
 * column from a dead end into a two-minute job.
 */
export function emailCell(draft: DraftEmail, website?: string | null): string {
  if (draft.body) return draft.body;
  if (!draft.missing.length) return "";
  const where = website ? `: ${website}` : "";
  const it = draft.missing.length === 1 ? "this" : "these";
  return `NEEDS: ${draft.missing.join(", ")} — find ${it} on the school's website${where} and fill in by hand`;
}
