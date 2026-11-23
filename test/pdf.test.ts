/**
 * PDF text extraction checks.
 *
 * Builds small but structurally real PDFs (both raw and FlateDecode content
 * streams) and confirms we recover the text — in particular the email
 * addresses, which are the whole point of reading school job packs.
 */

import { strict as assert } from "node:assert";
import { deflateRawSync, deflateSync } from "node:zlib";
import { test } from "node:test";
import { pdfToText } from "../src/enrich/pdf.ts";

/** Wrap a content stream in a minimal PDF skeleton. */
function makePdf(content: Buffer, flate: boolean): Buffer {
  const dict = flate
    ? `<< /Length ${content.length} /Filter /FlateDecode >>`
    : `<< /Length ${content.length} >>`;
  return Buffer.concat([
    Buffer.from("%PDF-1.4\n1 0 obj\n" + dict + "\nstream\n", "latin1"),
    content,
    Buffer.from("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1"),
  ]);
}

const BODY =
  "BT /F1 12 Tf 72 720 Td (Head of Physical Education - Job Pack) Tj " +
  "0 -20 Td (Applications to recruitment@example-school.org) Tj " +
  "0 -20 Td [(Contact the HR team on ) -250 (hr@example-school.org)] TJ ET";

test("reads an uncompressed content stream", () => {
  const text = pdfToText(makePdf(Buffer.from(BODY, "latin1"), false));
  assert.match(text, /Head of Physical Education/);
  assert.match(text, /recruitment@example-school\.org/);
  assert.match(text, /hr@example-school\.org/);
});

test("reads a FlateDecode content stream", () => {
  const text = pdfToText(makePdf(deflateSync(Buffer.from(BODY, "latin1")), true));
  assert.match(text, /recruitment@example-school\.org/);
  assert.match(text, /hr@example-school\.org/);
});

test("handles escaped parentheses and octal escapes", () => {
  const body = "BT (Email \\(preferred\\): jobs@school.edu) Tj (caf\\351) Tj ET";
  const text = pdfToText(makePdf(Buffer.from(body, "latin1"), false));
  assert.match(text, /jobs@school\.edu/);
  assert.match(text, /Email \(preferred\)/);
});

test("reads UTF-16BE hex strings", () => {
  const utf16 = Buffer.concat([
    Buffer.from([0xfe, 0xff]),
    Buffer.from("careers@intl.sch", "utf16le").swap16(),
  ]).toString("hex");
  const body = `BT <${utf16}> Tj ET`;
  const text = pdfToText(makePdf(Buffer.from(body, "latin1"), false));
  assert.match(text, /careers@intl\.sch/);
});

test("skips image XObjects without throwing", () => {
  const pdf = Buffer.concat([
    Buffer.from("%PDF-1.4\n1 0 obj\n<< /Subtype /Image /Length 4 >>\nstream\n", "latin1"),
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.from("\nendstream\nendobj\n", "latin1"),
    Buffer.from("2 0 obj\n<< /Length 30 >>\nstream\nBT (ok@school.org) Tj ET\nendstream\nendobj\n", "latin1"),
  ]);
  const text = pdfToText(pdf);
  assert.match(text, /ok@school\.org/);
});

test("returns empty string for a non-PDF buffer", () => {
  assert.equal(pdfToText(Buffer.from("just some text")), "");
  assert.equal(pdfToText(Buffer.alloc(0)), "");
});

/** A one-file zip, laid out the way Word writes a .docx. */
function zip(name: string, content: string): Buffer {
  const data = deflateRawSync(Buffer.from(content, "utf8"));
  const n = Buffer.from(name, "utf8");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt16LE(n.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(data.length, 20); cd.writeUInt16LE(n.length, 28); cd.writeUInt32LE(0, 42);
  const cdOffset = 30 + n.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(46 + n.length, 12); eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, n, data, cd, n, eocd]);
}

test("reads a Word .docx job pack", () => {
  const xml = `<w:document><w:body><w:p><w:r><w:t>Head of PE</w:t></w:r></w:p>` +
    `<w:p><w:r><w:t>Apply to hr@school.edu &amp; quote PE-01</w:t></w:r></w:p></w:body></w:document>`;
  const text = pdfToText(zip("word/document.xml", xml));
  assert.equal(text, "Head of PE\nApply to hr@school.edu & quote PE-01");
  assert.equal(pdfToText(zip("other.txt", "x")), "");
});
