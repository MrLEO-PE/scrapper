import { test } from "node:test";
import assert from "node:assert/strict";
import { formOnPage } from "../src/enrich/careerscan.ts";

const PAGE = "https://school.example/careers/";

test("a downloadable application form is found, with its kind", () => {
  const html = `<a href="/files/Application-form-for-employment.pdf">Download</a>`;
  assert.deepEqual(formOnPage(html, PAGE)?.kind, "pdf");
  const word = `<a href="/docs/Teacher application form.docx">Application Form</a>`;
  assert.equal(formOnPage(word, PAGE)?.kind, "word");
  assert.match(formOnPage(word, PAGE)!.url!, /Teacher%20application%20form\.docx$/);
});

test("an online form is found by its host, a Drive link by its words", () => {
  assert.equal(formOnPage(`<a href="https://forms.gle/AbC123">Apply here</a>`, PAGE)?.kind, "online");
  const drive = `<a href="https://drive.google.com/file/d/xyz/view">Staff Application Form</a>`;
  assert.equal(formOnPage(drive, PAGE)?.kind, "online");
});

test("brochures, job descriptions and student admission forms are not application forms", () => {
  assert.equal(formOnPage(`<a href="/files/Recruitment-Pack.pdf">Recruitment pack</a>`, PAGE), undefined);
  assert.equal(formOnPage(`<a href="/files/jd.pdf">Job description</a>`, PAGE), undefined);
  assert.equal(formOnPage(`<a href="/files/admission.pdf">Student Admission Application Form</a>`, PAGE), undefined);
  assert.equal(formOnPage(`<p>Please download the application form from our office.</p>`, PAGE), undefined);
});

test("student-admission platforms, summer programmes and sign-in pages are not staff forms", () => {
  assert.equal(formOnPage(`<a href="https://ise.openapply.com/apply">Apply</a>`, PAGE), undefined);
  assert.equal(formOnPage(`<a href="/files/Summer-Program-Application-form-2026.pdf">Application form</a>`, PAGE), undefined);
  assert.equal(formOnPage(`<a href="https://hhis.fsenrollment.com/users/sign_in">Application form</a>`, PAGE), undefined);
  assert.equal(formOnPage(`<a href="https://forms.gle/xyz">Staff application form</a>`, PAGE)?.kind, "online");
});
