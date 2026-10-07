/**
 * The prepared letters, built to the model in Leo_Sevin_Cover_Letter_Model_and_Method.pdf.
 *
 * Shape, in order: subject, greeting, opening (role + who I am), the hook
 * (one real fact about the school, then a bridge), the payoff (bullets), the
 * closing (availability, website, thanks, an invitation to a short call).
 *
 * The rules that govern every line:
 *   1. Never invent a fact about a school. A fact held for two or more schools
 *      is not evidence about any one of them, so it is not used.
 *   3. Cannot verify it? Leave it out. A shorter letter beats a doubtful fact:
 *      no name found means "Dear Principal and the HR Team"; no fact found
 *      means no hook paragraph, and the letter says so in its flags.
 *   4. Claim only what is true of me — everything about me comes from
 *      config/profile.json and nothing in this file.
 *   5. Flag every gap and clash instead of hiding it: a start date earlier
 *      than my availability, requirements I do not hold, a missing hook.
 *
 * Flags are returned beside the letter, never written into it, so the body can
 * be copied straight into a mail.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../core/logger.ts";
import type { Qualification } from "../core/types.ts";
import { assessFit } from "../match/fit.ts";
import { pickDuty, type StrengthKey } from "../match/advertpick.ts";
import { isStale, monthsAgo, type PrincipalSource } from "./factsource.ts";

export interface Bullet {
  key: string;
  /** Only used when the school's curriculum or advert matches this pattern. */
  when?: string;
  text: string;
}

export interface Profile {
  name: string;
  website: string;
  websiteLabel: string;
  signOff: string;
  /** Who I am, in two short sentences. */
  intro: string;
  /** Closes the hook: what I already do, then what I would add. */
  bridge: string;
  /** What I answer a quoted advert line with, by which strength fits it. */
  adBridges: Record<StrengthKey, string>;
  /** Used instead of the bridge when no fact about the school was found. */
  bulletsWhenNoHook: string;
  bullets: Bullet[];
  availability: string;
  /** YYYY-MM — the earliest month I can start. */
  availableFrom: string;
  websiteLine: string;
  closing: string;
  applyOpening: string;
  speculativeOpening: string;
  groupOpening: string;
  qualifications?: Qualification[];
}

export interface DraftEmail {
  /** The finished message, ready to paste. */
  body: string;
  subject: string;
  /** Only ever non-empty when no letter could be written at all. */
  missing: string[];
  /** Things to check before sending. Never part of the body. */
  flags: string[];
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

/** Connectors that stay lowercase inside a title: "Head of PE", not "Head Of PE". */
const LOWER_IN_TITLE = new Set(["of", "and", "the", "for", "in", "at", "to", "a", "an", "or"]);

/**
 * Boards often shout a job title. Only fully-shouted titles are touched;
 * anything already mixed-case is left exactly as the school wrote it, because
 * the role must match the advert word for word.
 */
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
      if (bare.length <= 5 && !/[AEIOU]/.test(bare)) return word;
      if (!first && LOWER_IN_TITLE.has(bare.toLowerCase())) return word.toLowerCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join("");
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/**
 * Does the advert want someone sooner than I am free?
 *
 * Reads only an explicit month and year near a word about starting, or an
 * "ASAP". Returns the phrase found, so the flag can quote it.
 */
export function startClash(advert: string, availableFrom: string): string | null {
  const text = advert.replace(/\s+/g, " ");
  if (/\b(?:asap|immediate(?:ly)?\s+(?:start|available|vacancy)|start\s+immediately)\b/i.test(text)) {
    return "advert asks for an immediate start";
  }
  const re = new RegExp(
    `\\b(?:start(?:ing|s)?|commenc\\w*|begin\\w*|join\\w*|from|effective|available)\\b[^.]{0,30}?\\b(${MONTHS.join("|")})\\s+(20\\d{2})\\b`,
    "gi",
  );
  const [fy, fm] = availableFrom.split("-").map(Number);
  for (const m of text.matchAll(re)) {
    const year = Number(m[2]);
    const month = MONTHS.indexOf(m[1]!.toLowerCase()) + 1;
    if (year * 12 + month < fy! * 12 + fm!) return `advert wants a start in ${m[1]} ${m[2]}`;
  }
  return null;
}

/** "Mr Myles Jackson" -> "Myles Jackson". The salutation is "Principal", not "Mr". */
const bareName = (n: string): string => n.replace(/^(?:Mr|Mrs|Ms|Miss|Dr|Prof|Professor)\.?\s+/i, "").trim();

export interface LetterInputs {
  /** Application: the exact role. Speculative: omit. */
  role?: string;
  /** One school, or several for a shared inbox. */
  schools: string[];
  /** Verified, and about this school alone — never a hook shared with another. */
  principal?: string | null;
  /** Where the name was read. Without it the name is used but flagged. */
  principalSource?: PrincipalSource;
  schoolHook?: string | null;
  peHook?: string | null;
  curriculum?: string[] | null;
  /** The advert, for requirement gaps and start dates. */
  advertText?: string | null;
}

function listed(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The one builder behind every letter, so the three kinds cannot drift apart.
 */
export function buildLetter(i: LetterInputs): DraftEmail {
  const profile = loadProfile();
  if (!profile) return { body: "", subject: "", missing: ["config/profile.json is missing"], flags: [] };

  const flags: string[] = [];
  const group = i.schools.length > 1;
  const schoolText = listed(i.schools);
  const role = i.role ? tidyRole(i.role) : "";

  const subject = role
    ? `${profile.name.toUpperCase()} - Application ${role}`
    : `${profile.name.toUpperCase()} - Speculative application, PE Teacher`;

  // Greeting. A name only when we hold one; never a placeholder.
  let greeting = "Dear Principal and the HR Team,";
  if (!group && i.principal) {
    const src = i.principalSource;
    const name = bareName(i.principal);
    if (src && src.kind !== "school-page") {
      // Rule 2: the name comes from the school's own page. A name that was
      // only found in an advert, or whose source was never recorded, is left
      // out (rule 3) and said so, so it can be confirmed and used.
      flags.push(
        src.kind === "advert"
          ? `a principal "${name}" appears only in a job advert, not on the school's own page — confirm it there to use the name`
          : `a principal "${name}" is on file but its source was never recorded — confirm it on the school's own page to use the name`,
      );
    } else {
      greeting = `Dear Principal ${name} and the HR Team,`;
      if (!src) flags.push("check the principal's name on the school's own page");
      else if (isStale(src)) {
        flags.push(
          `principal's name was last read ${monthsAgo(src.seenAt)} months ago — people change in July and August, so re-check it on the school's own page before sending`,
        );
      }
    }
  } else if (group) {
    greeting = "Dear HR Team,";
  }

  const opening = role
    ? fill(profile.applyOpening, { role, school: schoolText })
    : fill(group ? profile.groupOpening : profile.speculativeOpening, { school: schoolText });

  const advert = i.advertText ?? "";

  /*
   * The hook: one real fact, then what I would add.
   *
   * For an application the best fact is a duty from the advert itself, quoted
   * exactly — it is this job, in the school's own words, and it is answered
   * with the strength that fits it. Failing that, a fact read off the school's
   * own pages; failing that, no hook, and the flags say so. A group inbox has
   * no single school to say a fact about, so it gets none.
   */
  const duty = !group && role ? pickDuty(advert) : null;
  const hook = group
    ? null
    : duty
      ? `One line in your advert stood out: "${duty.sentence}." ${profile.adBridges[duty.key]} ${profile.bulletsWhenNoHook}`
      : i.peHook
        ? `I noticed ${i.peHook}. ${profile.bridge}`
        : i.schoolHook
          ? `${i.schools[0]} ${i.schoolHook}. ${profile.bridge}`
          : null;
  if (!hook && !group) flags.push("no specific fact found for this school — add one from their own site before sending");

  const evidence = `${(i.curriculum ?? []).join(" ")} ${advert} ${i.peHook ?? ""}`;
  const bullets = profile.bullets
    .filter((b) => !b.when || new RegExp(b.when, "i").test(evidence))
    // The strength that answers the advert's line goes first.
    .sort((a, b) => Number(b.key === duty?.key) - Number(a.key === duty?.key))
    .map((b) => `• ${b.text}`);

  if (advert) {
    const clash = startClash(advert, profile.availableFrom);
    if (clash) flags.push(`${clash}, but I am free from ${profile.availableFrom}`);
    const fit = assessFit(advert, profile.qualifications ?? []);
    for (const gap of fit.gaps) flags.push(`advert asks for ${gap}, which is not in my profile`);
  }

  const body = [
    greeting,
    "",
    `${opening} ${profile.intro}`,
    "",
    hook ?? profile.bulletsWhenNoHook,
    "",
    ...bullets,
    "",
    `${profile.availability} ${fill(profile.websiteLine, { website: `${profile.websiteLabel}: ${profile.website}` })}`,
    "",
    profile.closing,
    "",
    `${profile.signOff},`,
    profile.name,
  ].join("\n");

  return { body, subject, missing: [], flags };
}

// ---- the three kinds of letter -------------------------------------------

export interface EmailInputs {
  role: string;
  school: string;
  principal?: string | null;
  principalSource?: PrincipalSource;
  schoolHook?: string | null;
  peHook?: string | null;
  advertText?: string | null;
  curriculum?: string[] | null;
}

/** A letter answering a specific advert. */
export function draftEmail(i: EmailInputs): DraftEmail {
  return buildLetter({
    role: i.role,
    schools: [i.school],
    principal: i.principal,
    principalSource: i.principalSource,
    schoolHook: i.schoolHook,
    peHook: i.peHook,
    advertText: i.advertText,
    curriculum: i.curriculum,
  });
}

export interface SpeculativeInputs {
  school: string;
  principal?: string | null;
  principalSource?: PrincipalSource;
  schoolHook?: string | null;
  peHook?: string | null;
  accreditation?: string | null;
  curriculum?: string[] | null;
  studentCount?: number | null;
}

/** A letter to a school that is not advertising. */
export function speculativeEmail(i: SpeculativeInputs): DraftEmail {
  return buildLetter({
    schools: [i.school],
    principal: i.principal,
    principalSource: i.principalSource,
    schoolHook: i.schoolHook,
    peHook: i.peHook,
    curriculum: i.curriculum,
  });
}

export interface GroupInputs {
  schools: string[];
  country?: string | null;
  city?: string | null;
}

/**
 * One letter to a shared inbox covering several schools. It says nothing
 * specific about any of them — that would be a fact about one school sent to
 * an address that reads for all of them.
 */
export function groupSpeculativeEmail(i: GroupInputs): DraftEmail {
  if (i.schools.length < 2) return { body: "", subject: "", missing: ["not a group address"], flags: [] };
  return buildLetter({ schools: i.schools });
}

/** ["CIS","WASC","IB"] -> "CIS, WASC and IB". */
function andList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export interface FactInputs {
  school: string;
  schoolHook?: string | null;
  accreditation?: string | null;
  curriculum?: string[] | null;
  studentCount?: number | null;
}

/**
 * Whether anything verified is held about a school, for "is this ready to
 * write". Not used in the letter itself: accreditation and curriculum are
 * shared by many schools, so they make a weak hook and are never said back.
 */
export function schoolFact(i: FactInputs): string | null {
  if (i.schoolHook) return `${i.school} ${i.schoolHook}`;
  const parts: string[] = [];
  if (i.accreditation) parts.push(`accredited by ${andList(i.accreditation.split(/\s*,\s*/).filter(Boolean))}`);
  const cur = i.curriculum?.filter(Boolean).slice(0, 3) ?? [];
  if (cur.length) parts.push(`runs ${andList(cur)}`);
  return parts.length ? `${i.school} is ${parts.join(" and ")}` : null;
}

/**
 * The cell for the Prepared Email column: the letter. Flags have their own
 * column, so the cell can be copied whole.
 */
export function emailCell(draft: DraftEmail, website?: string | null): string {
  if (draft.body) return draft.body;
  if (!draft.missing.length) return "";
  const where = website ? `: ${website}` : "";
  return `NEEDS: ${draft.missing.join(", ")}${where}`;
}
