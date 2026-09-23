/**
 * Application-form detection.
 *
 * The column answers "will I have to fill in a form before applying?", so the
 * job is to separate three things that all get called an application form:
 * a document you download and complete, a web form, and reading material that
 * merely has "application" in its name.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { detectApplicationForm, formLabel } from "../src/match/appform.ts";

test("finds a downloadable Word form attached to the advert", () => {
  const f = detectApplicationForm({
    attachments: [
      { url: "https://cdn.example.org/a/Teaching-Application-Form.docx", caption: "Application Form" },
    ],
  });
  assert.equal(f.kind, "word");
  assert.match(f.url ?? "", /Teaching-Application-Form\.docx/);
  assert.equal(formLabel(f), "Yes — Word");
});

test("finds a downloadable PDF form", () => {
  const f = detectApplicationForm({
    attachments: [{ url: "https://example.org/files/staff-application.pdf" }],
  });
  assert.equal(f.kind, "pdf");
  assert.equal(formLabel(f), "Yes — PDF");
});

test("does not mistake reading material for a form", () => {
  // Real attachment names from TES adverts. None is a form to fill in.
  const notForms = [
    { url: "https://cdn/DIS-Teacher-Recruitment-Pack-2026.pdf", caption: "Recruitment Pack" },
    { url: "https://cdn/GIS-Talent-Candidate-Brochure-AY-26-27.pdf", caption: "Candidate Brochure" },
    { url: "https://cdn/safe-at-school-policy.pdf", caption: "Safeguarding policy" },
    { url: "https://cdn/KHDA-inspection-report-2023.pdf", caption: "Inspection report" },
    { url: "https://cdn/job-description.pdf", caption: "Job Description" },
  ];
  for (const a of notForms) {
    assert.equal(detectApplicationForm({ attachments: [a] }).kind, "none", a.url);
  }
});

test("finds a form linked from a careers page", () => {
  const f = detectApplicationForm({
    links: [
      { url: "https://school.ac.th/about", text: "About us" },
      { url: "https://school.ac.th/files/Application-Form-2026.doc", text: "Application form" },
    ],
  });
  assert.equal(f.kind, "word");
  assert.match(f.url ?? "", /Application-Form-2026\.doc/);
});

test("reads the advert when it says to download a form", () => {
  const f = detectApplicationForm({
    text: "To apply, please download the application form and return the completed form by email.",
  });
  assert.equal(f.kind, "pdf");
  assert.ok(f.evidence);
});

test("recognises an online form as different from a download", () => {
  // Real wording from TES adverts.
  for (const text of [
    "To apply please complete the online application form.",
    "Applications can be submitted via the TES online application form.",
    "Complete the application form on the website via the Quick Apply button.",
    "Applicants are requested to complete the Online Cover Teacher Application Form (Google Form).",
  ]) {
    const f = detectApplicationForm({ text });
    assert.equal(f.kind, "online", text);
    assert.equal(formLabel(f), "Yes — online");
  }
});

test("says none when nothing mentions a form", () => {
  const f = detectApplicationForm({
    text: "Send your CV and a covering letter to the Principal.",
    attachments: [{ url: "https://cdn/prospectus.pdf", caption: "Prospectus" }],
  });
  assert.equal(f.kind, "none");
  assert.equal(formLabel(f), "No");
});

test("an attached form outranks the advert's wording", () => {
  // The document itself is better evidence than a sentence about one.
  const f = detectApplicationForm({
    attachments: [{ url: "https://cdn/application-form.docx", caption: "Application Form" }],
    text: "Please complete the online application form.",
  });
  assert.equal(f.kind, "word");
  assert.ok(f.url);
});

test("ignores a form-named link that is not a document", () => {
  const f = detectApplicationForm({
    links: [{ url: "https://school.org/application-form", text: "Application form" }],
  });
  // No file extension: it is a web page, so not a download.
  assert.equal(f.kind, "none");
});
