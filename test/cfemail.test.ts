import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeCloudflareEmails } from "../src/enrich/email.ts";

test("decodes a Cloudflare-protected address from a link", () => {
  const html = '<a href="/cdn-cgi/l/email-protection#1c6a7d7f7d727f75796f5c6e79727d756f6f7d727f7932797869326a72">Apply</a>';
  assert.deepEqual(decodeCloudflareEmails(html), ["vacancies@renaissance.edu.vn"]);
});

test("decodes data-cfemail and ignores junk", () => {
  assert.deepEqual(decodeCloudflareEmails('<span data-cfemail="1c6a7d7f7d727f75796f5c6e79727d756f6f7d727f7932797869326a72">'), ["vacancies@renaissance.edu.vn"]);
  assert.deepEqual(decodeCloudflareEmails('<a href="#abcdef0123">x</a> email-protection#zz'), []);
});

import { jsonLdEmails } from "../src/enrich/email.ts";

test("reads the email in a page's JSON-LD", () => {
  const html = '<script type="application/ld+json">{"@type":"School","telephone":"+84 1","email": "bishanoi@bishanoi.com"}</script><script>var email="x@y.com"</script>';
  assert.deepEqual(jsonLdEmails(html), ["bishanoi@bishanoi.com"]);
});
