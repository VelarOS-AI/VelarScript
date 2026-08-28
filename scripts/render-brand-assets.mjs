import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// The social preview card carries the positioning sentence, so it goes stale
// whenever the positioning changes (D78, D105). Keeping the card as source
// rather than as an opaque PNG is what makes re-rendering it a one-line job:
//   node scripts/render-brand-assets.mjs
// The avatar and the card are the two GitHub surfaces with no API — both are
// uploaded by hand in the organization and repository settings.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const brand = join(root, "assets", "brand");

const POSITIONING =
  "An extensible application-layer programming language for the AI era, " +
  "where the framework is the language.";
const KEYWORDS = "component &nbsp;·&nbsp; state &nbsp;·&nbsp; computed &nbsp;·&nbsp; look &nbsp;—&nbsp; keywords, not imports";
const INK = "#181818";
const PAPER = "#FFFFFF";
const FONT = `-apple-system, "SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif`;

// The mark is read from the design source so the exports can never drift from
// it; only `fill` is substituted, and the view box and geometry are preserved.
const markSource = await readFile(join(brand, "velarscript-mark.svg"), "utf8");
const mark = (ink) => markSource
  .replace(/<title[^>]*>.*?<\/title>/s, "")
  .replace(/<g\b[^>]*>/, `<g fill="${ink}">`);

const avatar = (background, ink) => `<style>
  html, body { margin: 0; padding: 0 }
  .avatar { width: 512px; height: 512px; background: ${background};
            display: flex; align-items: center; justify-content: center }
  .avatar svg { width: 330px }
</style><div class="avatar">${mark(ink)}</div>`;

const card = (background, ink, rule) => `<style>
  html, body { margin: 0; padding: 0 }
  .card { width: 1280px; height: 640px; background: ${background}; color: ${ink};
          font-family: ${FONT}; display: flex; flex-direction: column;
          justify-content: center; padding: 0 104px; box-sizing: border-box }
  .name { display: flex; align-items: center; gap: 36px }
  .name svg { width: 112px; flex: none }
  h1 { font-size: 104px; line-height: 1; margin: 0; font-weight: 600; letter-spacing: -.035em }
  p { font-size: 31px; line-height: 1.45; margin: 40px 0 0; max-width: 1000px; opacity: .78;
      letter-spacing: -.005em }
  .keywords { margin-top: 44px; padding-top: 34px; border-top: 1px solid ${rule};
              font-size: 22px; opacity: .55; white-space: nowrap;
              font-family: ui-monospace, "SF Mono", Menlo, monospace }
</style><div class="card">
  <div class="name">${mark(ink)}<h1>VelarScript</h1></div>
  <p>${POSITIONING}</p>
  <div class="keywords">${KEYWORDS}</div>
</div>`;

const exports = [
  ["velarscript-avatar.png", avatar(PAPER, INK), 512, 512],
  ["velarscript-social-preview-light.png", card(PAPER, INK, "rgba(24,24,24,.14)"), 1280, 640],
  ["velarscript-social-preview-dark.png", card(INK, PAPER, "rgba(255,255,255,.16)"), 1280, 640],
];

const browser = await chromium.launch();
try {
  for (const [name, html, width, height] of exports) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "load" });
    await writeFile(join(brand, name), await page.screenshot());
    await page.close();
    console.log(`${name} ${width}×${height}`);
  }
} finally {
  await browser.close();
}
