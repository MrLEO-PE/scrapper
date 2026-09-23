/**
 * Does this school make you fill in an application form?
 *
 * Worth knowing before you start, because it changes how long applying takes.
 * Two quite different things get called "an application form":
 *
 *   - a **PDF or Word document** you download, complete and send back;
 *   - an **online form** on the board or the school's site.
 *
 * Only the first is real work in advance, so they are reported separately
 * rather than collapsed into a yes.
 *
 * Evidence comes from three places, most reliable first: a document attached to
 * the advert, a form link on the page, and the advert's own wording.
 */

import type { ApplicationForm, Attachment } from "../core/types.ts";

/** A document that is a form to complete, not a brochure to read. */
const FORM_NAME =
  /\b(?:application[\s\-_]*(?:form|pack)?|candidate[\s\-_]*(?:form|details)|staff[\s\-_]*application|employment[\s\-_]*(?:form|application)|personal[\s\-_]*details|applicant[\s\-_]*(?:form|details)|recruitment[\s\-_]*form|self[\s\-_]*declaration|equal[\s\-_]*opportunities)\b/i;

/**
 * Documents that merely mention "application" while being reading material.
 * A "Recruitment Pack" or "Candidate Brochure" is not a form to fill in.
 */
const NOT_A_FORM =
  /\b(?:brochure|prospectus|policy|policies|report|inspection|newsletter|handbook|guide|guidance|welcome|profile|advert|job[\s\-_]*description|jd\b|person[\s\-_]*spec|safeguarding|child[\s\-_]*protection|terms|benefits|package|pack\b)\b/i;

const WORD_EXT = /\.(?:docx?|rtf|odt)(?:$|\?)/i;
const PDF_EXT = /\.pdf(?:$|\?)/i;

/** Advert wording that says a form must be completed. */
const TEXT_ONLINE =
  /\b(?:online\s+application\s+form|apply\s+online|complete\s+the\s+online\s+form|quick\s+apply|google\s+form|via\s+the\s+(?:tes|schrole)\s+(?:online\s+)?application)\b/i;

const TEXT_DOWNLOAD =
  /\b(?:download\s+(?:the\s+|our\s+)?(?:application|form)|complete\s+the\s+attached|attached\s+application\s+form|application\s+form\s+(?:attached|below|can\s+be\s+downloaded)|return\s+the\s+completed\s+form)\b/i;

const TEXT_ANY_FORM =
  /\b(?:application\s+form|application\s+pack|standard\s+application|complete\s+the\s+form)\b/i;

const fileName = (url: string): string => {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
  } catch {
    return url.split("/").pop() ?? url;
  }
};

/** Is this attachment a form to complete? */
function scoreAttachment(a: Attachment): ApplicationForm | null {
  const label = `${a.caption ?? ""} ${fileName(a.url)}`;
  if (!FORM_NAME.test(label)) return null;
  // "Recruitment Pack", "Candidate Brochure" — reading material, not a form.
  if (NOT_A_FORM.test(label)) return null;

  const kind = WORD_EXT.test(a.url) ? "word" : PDF_EXT.test(a.url) ? "pdf" : null;
  if (!kind) return null;

  return { kind, url: a.url, evidence: (a.caption || fileName(a.url)).trim() };
}

export interface DetectInput {
  attachments?: Attachment[];
  /** Links found on the advert or careers page: [url, anchor text]. */
  links?: { url: string; text?: string }[];
  /** The advert body. */
  text?: string;
}

/**
 * Work out whether an application form is involved.
 *
 * Returns `kind: "none"` when nothing was found — which means "not stated
 * here", not a guarantee that no form exists.
 */
export function detectApplicationForm(input: DetectInput): ApplicationForm {
  // 1. A document attached to the advert is the strongest signal.
  for (const a of input.attachments ?? []) {
    const hit = scoreAttachment(a);
    if (hit) return hit;
  }

  // 2. A form link on the page.
  for (const link of input.links ?? []) {
    const hit = scoreAttachment({ url: link.url, caption: link.text });
    if (hit) return hit;
  }

  // 3. The advert's own wording.
  const text = input.text ?? "";
  if (text) {
    if (TEXT_DOWNLOAD.test(text)) {
      // It says to download a form but we never found the file itself.
      return { kind: "pdf", evidence: firstMatch(text, TEXT_DOWNLOAD) };
    }
    if (TEXT_ONLINE.test(text)) {
      return { kind: "online", evidence: firstMatch(text, TEXT_ONLINE) };
    }
    if (TEXT_ANY_FORM.test(text)) {
      // A form is mentioned without saying which sort; online is far more
      // common, so that is the safer reading.
      return { kind: "online", evidence: firstMatch(text, TEXT_ANY_FORM) };
    }
  }

  return { kind: "none" };
}

function firstMatch(text: string, re: RegExp): string {
  const m = re.exec(text);
  if (!m) return "";
  const start = Math.max(0, m.index - 40);
  return text.slice(start, m.index + m[0].length + 60).replace(/\s+/g, " ").trim();
}

/** How the column reads in the sheet. */
export function formLabel(f: ApplicationForm | null | undefined): string {
  switch (f?.kind) {
    case "pdf": return "Yes — PDF";
    case "word": return "Yes — Word";
    case "online": return "Yes — online";
    default: return "No";
  }
}
