/**
 * Yew Chung / Yew Wah: the ASP.NET job table and its postback paging.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { isoDate, nextPage, placeOf, rowsFrom } from "../src/sources/ycyw.ts";

const PAGE = `<input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="abc&amp;d" />
<table id="dgPostedJobs"><tr class="JobRowAlternate" align="left"> <td class="jobListTr" align="left">
<a href='JobDetail.aspx?PostID=4188&Navigation=false' class="jobListTd" target="_blank"> Whole-School Athletics Coordinator </a> </td>
<td class="jobListTr" align="center">11/11/2026</td><td>YCIS - Shanghai(Pudong) (ShanghaiPuDong SEC) </td><td>1</td></tr>
<tr class="jobSearchPages"><td colspan="5"><span>1</span>&nbsp;<a href="javascript:__doPostBack(&#39;dgPostedJobs$_ctl24$_ctl1&#39;,&#39;&#39;)">2</a></td></tr></table>`;

test("reads the job rows", () => {
  const [row] = rowsFrom(PAGE);
  assert.deepEqual(row, {
    id: "4188",
    title: "Whole-School Athletics Coordinator",
    posted: "11/11/2026",
    location: "YCIS - Shanghai(Pudong) (ShanghaiPuDong SEC)",
  });
  assert.equal(isoDate(row!.posted), "2026-11-11");
});

test("places a campus", () => {
  assert.deepEqual(placeOf("YCIS - Shanghai(Pudong) (ShanghaiPuDong SEC)"), { city: "Shanghai", country: "China" });
  assert.deepEqual(placeOf("YCIS - Hong Kong"), { city: "Hong Kong", country: "Hong Kong" });
});

test("finds the next page's postback", () => {
  const next = nextPage(PAGE, 1)!;
  assert.equal(next.target, "dgPostedJobs$_ctl24$_ctl1");
  assert.equal(next.fields.__VIEWSTATE, "abc&d");
  assert.equal(nextPage(PAGE, 2), null);
});
