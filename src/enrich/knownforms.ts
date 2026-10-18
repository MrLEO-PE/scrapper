/**
 * Application forms found for schools.
 *
 * Some schools will not look at a letter without their own form completed —
 * a Word or PDF document to download, fill in and send back, or an online
 * form. The Email tab shows the link beside the letter so the two are done
 * together, and the letter's own checks stay as they were.
 *
 * Found by `npm run hr-scan -- --forms`, which records the page each form was
 * linked from; or added by hand when you come across one. Same file shape and
 * same rule as school-emails.json: an address copied from the school's own
 * page, never one worked out from a pattern.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../core/logger.ts";

export type FormKind = "word" | "pdf" | "online";

export interface KnownForm {
  kind: FormKind;
  url: string;
  /** The page it was linked from, so it can be checked. */
  page?: string;
  found?: string;
  note?: string;
}

export const FORMS_PATH = join(process.cwd(), "config", "school-forms.json");

let cache: Record<string, KnownForm> | null = null;

function load(): Record<string, KnownForm> {
  if (cache) return cache;
  cache = {};
  if (!existsSync(FORMS_PATH)) return cache;
  try {
    const parsed = JSON.parse(readFileSync(FORMS_PATH, "utf8")) as Record<string, unknown>;
    for (const [key, value] of Object.entries(parsed)) {
      if (key.startsWith("//") || typeof value !== "object" || !value) continue;
      const f = value as KnownForm;
      if (f.url && /^https?:\/\//i.test(f.url) && ["word", "pdf", "online"].includes(f.kind)) cache[key] = f;
    }
  } catch (err) {
    log.warn(`could not read ${FORMS_PATH}: ${(err as Error).message}`);
  }
  return cache;
}

export function resetForms(): void {
  cache = null;
}

/** The application form recorded for a school, if any. */
export function knownForm(schoolKey: string): KnownForm | undefined {
  return load()[schoolKey];
}

export const FORM_LABEL: Record<FormKind, string> = {
  word: "Word document",
  pdf: "PDF form",
  online: "online form",
};
