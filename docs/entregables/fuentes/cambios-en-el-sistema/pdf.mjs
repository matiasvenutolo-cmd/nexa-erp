// HTML (páginas A4 fijas) → PDF con Chrome; opcional: una vista por página y aviso de desbordes.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
const [html, pdf, prevDir] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const p = await b.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 1 });
await p.goto("file://" + html, { waitUntil: "networkidle" });
await p.evaluate(() => document.fonts.ready);
const desb = await p.evaluate(() =>
  [...document.querySelectorAll(".page")]
    .map((pg, i) => {
      const r = pg.getBoundingClientRect();
      let max = 0;
      pg.querySelectorAll("*").forEach((e) => {
        if (getComputedStyle(e).position === "absolute" || e.closest(".portada") || e.closest("[style*='position:absolute']")) return;
        const bb = e.getBoundingClientRect();
        if (bb.height) max = Math.max(max, bb.bottom - r.top);
      });
      return { pag: i + 1, alto: Math.round((max / r.height) * 297) };
    })
    .filter((x) => x.alto > 282),
);
console.log("desbordes(mm):", JSON.stringify(desb));
if (prevDir) {
  mkdirSync(prevDir, { recursive: true });
  const pgs = await p.$$(".page");
  for (let i = 0; i < pgs.length; i++) await pgs[i].screenshot({ path: `${prevDir}/q${String(i + 1).padStart(2, "0")}.png` });
}
await p.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true });
await b.close();
console.log("ok");
