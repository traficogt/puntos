import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, "public");
const SVG_PATH = path.join(PUBLIC_DIR, "icon.svg");
const OUTPUTS = [
  ["favicon-16.png", 16],
  ["favicon-32.png", 32],
  ["apple-touch-icon.png", 180],
  ["icon-192.png", 192],
  ["icon-512.png", 512]
];

process.env.PLAYWRIGHT_BROWSERS_PATH ??= "0";

const svg = await fs.readFile(SVG_PATH, "utf8");
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();

  for (const [fileName, size] of OUTPUTS) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<!doctype html>
      <html>
      <head>
        <style>
          html, body {
            margin: 0;
            width: ${size}px;
            height: ${size}px;
            background: transparent;
            overflow: hidden;
          }
          svg {
            display: block;
            width: ${size}px;
            height: ${size}px;
          }
        </style>
      </head>
      <body>${svg}</body>
      </html>`
    );
    await page.screenshot({ path: path.join(PUBLIC_DIR, fileName), omitBackground: true });
  }
} finally {
  await browser.close();
}
