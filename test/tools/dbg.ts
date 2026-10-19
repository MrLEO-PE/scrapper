import { fetchText } from "../../src/core/http.ts";
import { careerLinks, candidatesFromPage, addressesOn } from "../../src/enrich/careerscan.ts";
for (const [site, path] of [["https://ise.ac.th/", "https://ise.ac.th/careers/"], ["https://www.brs.edu.cn/en/", "https://www.brs.edu.cn/en/hr"], ["https://has.hc.edu.tw/", "https://has.hc.edu.tw/careers"]]) {
  const h = (await fetchText(site, { soft: true, retries: 0, fresh: true }))!;
  console.log(site, "links:", careerLinks(h, site).join(" | "));
  const p = (await fetchText(path, { soft: true, retries: 0, fresh: true }))!;
  console.log("  page", path, "addresses:", addressesOn(p).join(","), "| cands:", candidatesFromPage(p, path, site, true).map((c) => c.email + ":" + c.score).join(","));
}
