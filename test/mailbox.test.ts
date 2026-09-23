/**
 * Email-alert parsing.
 *
 * The paid services (Search Associates, ISS, TIE, Schrole) deliver vacancies by
 * email rather than letting you scrape their members' area, so this parser is
 * the only way those postings reach the sheet. It has to cope with what real
 * mail generators produce: multipart bodies, quoted-printable, base64 and
 * encoded-word subject lines.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseEml } from "../src/sources/mailbox.ts";

/** Build a message with CRLF line endings, as a real mail file has. */
const eml = (lines: string[]): string => lines.join("\r\n");

test("reads a simple plain-text alert", () => {
  const mail = parseEml(
    eml([
      "From: alerts@searchassociates.com",
      "Subject: New vacancies matching your profile",
      "Date: Mon, 22 Sep 2026 07:00:00 +0000",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Head of Physical Education - Dubai",
      "PE Teacher - Singapore",
    ]),
  );
  assert.match(mail.from, /searchassociates\.com/);
  assert.match(mail.subject, /New vacancies/);
  assert.match(mail.text, /Head of Physical Education/);
});

test("decodes quoted-printable bodies", () => {
  const mail = parseEml(
    eml([
      "From: jobs@tieonline.com",
      "Subject: Job alert",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      // "Director of Sport =E2=80=93 Qatar" with a soft line break.
      "Director of Sport =E2=80=93 Qat=",
      "ar",
    ]),
  );
  assert.match(mail.text, /Director of Sport/);
  assert.match(mail.text, /Qatar/);
});

test("decodes base64 bodies", () => {
  const body = Buffer.from("Head of PE - Bangkok Patana School", "utf8").toString("base64");
  const mail = parseEml(
    eml([
      "From: noreply@iss.edu",
      "Subject: EDUrecruit alert",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      body,
    ]),
  );
  assert.match(mail.text, /Head of PE - Bangkok Patana School/);
});

test("walks a multipart/alternative message and prefers both parts", () => {
  const mail = parseEml(
    eml([
      "From: alerts@schrole.com",
      "Subject: Matching roles",
      'Content-Type: multipart/alternative; boundary="SEP"',
      "",
      "--SEP",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "PE Teacher - Kuala Lumpur",
      "--SEP",
      "Content-Type: text/html; charset=utf-8",
      "",
      '<a href="https://schrole.com/job/123">Head of Sport - Kuala Lumpur</a>',
      "--SEP--",
    ]),
  );
  assert.match(mail.text, /PE Teacher - Kuala Lumpur/);
  assert.match(mail.html, /Head of Sport - Kuala Lumpur/);
});

test("decodes an encoded-word subject", () => {
  const encoded = "=?utf-8?B?" + Buffer.from("Nouvelles offres – EPS", "utf8").toString("base64") + "?=";
  const mail = parseEml(
    eml([`From: a@b.com`, `Subject: ${encoded}`, "Content-Type: text/plain", "", "body"]),
  );
  assert.match(mail.subject, /Nouvelles offres/);
});

test("survives a message with no body", () => {
  const mail = parseEml(eml(["From: a@b.com", "Subject: Empty"]));
  assert.equal(mail.subject, "Empty");
  assert.equal(mail.text.trim(), "");
  assert.equal(mail.html.trim(), "");
});

test("unfolds headers split across lines", () => {
  const mail = parseEml(
    eml([
      "From: alerts@searchassociates.com",
      "Subject: Weekly vacancies for",
      "  Physical Education",
      "Content-Type: text/plain",
      "",
      "body",
    ]),
  );
  assert.match(mail.subject, /Weekly vacancies for Physical Education/);
});
