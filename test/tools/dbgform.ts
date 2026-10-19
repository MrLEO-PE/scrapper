import { fetchText } from "../../src/core/http.ts";
import { careerLinks, pageLinks } from "../../src/enrich/careerscan.ts";
for (const site of ["https://www.dishs.tp.edu.tw/", "https://www.ise.ac.th/", "https://www.hia.com.tw/"]) {
  const home = (await fetchText(site, { soft: true, retries: 0, fresh: true }))!;
  const cl = careerLinks(home, site);
  console.log("\n##", site, "career links:", cl.slice(0, 4).join(" | "));
  for (const u of [site, ...cl.slice(0, 3)]) {
    const h = u === site ? home : await fetchText(u, { soft: true, retries: 0, fresh: true });
    if (!h) continue;
    const docs = pageLinks(h, u).filter((l) => /\.(docx?|odt|pdf|rtf)(\?|$)|forms\.gle|docs\.google\.com\/forms|form/i.test(l.url + " " + l.text));
    console.log("  ", u.replace(/^https?:\/\//, "").slice(0, 60), "→", docs.slice(0, 5).map((d) => `${d.text.slice(0, 30)} <${d.url.slice(-50)}>`).join(" ; ") || "(no document/form links)");
  }
}
