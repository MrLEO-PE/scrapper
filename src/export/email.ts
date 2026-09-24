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

export function draftEmail(inputs: EmailInputs): DraftEmail {
  const profile = loadProfile();
  if (!profile) {
    return { body: "", subject: "", missing: ["config/profile.json is missing"] };
  }

  const missing: string[] = [];
  if (!inputs.principal) missing.push("principal name");
  if (!inputs.schoolHook) missing.push("school fact");
  if (!inputs.peHook) missing.push("PE/sport fact");

  const subject = `Application for ${inputs.role}, ${profile.name}`;

  // Refuse to write a half-personalised email. The whole value of this column
  // is that every detail in it is real.
  if (missing.length) return { body: "", subject, missing };

  const values = {
    role: inputs.role,
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
    `Dear ${inputs.principal} and the HR Team,`,
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
