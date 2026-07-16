/* テスト共通ヘルパー：Chromium起動とビューアの読み込み */
const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.dirname(__dirname);
const VIEWER_URL = 'file://' + encodeURI(path.join(ROOT, 'IFファイルビューア.html')).replace(/#/g, '%23');
const SAMPLES = path.join(ROOT, 'samples');

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), '.cache', 'ms-playwright'),
    '/opt/pw-browsers',
  ].filter(Boolean);
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const d of fs.readdirSync(root).sort().reverse()) {
      if (!/^chromium-\d+$/.test(d)) continue;
      for (const cand of ['chrome-linux/chrome', 'chrome-linux64/chrome',
                          'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-win/chrome.exe']) {
        const p = path.join(root, d, cand);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return null; // playwright-core の既定解決に任せる
}

async function launchViewer(opts = {}) {
  const exe = findChromium();
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  if (opts.clipboard) await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(VIEWER_URL);
  return { browser, page, errors };
}

/* ビューア内でファイルを開く（bytes は number[] で渡す） */
async function openBytes(page, name, bytes) {
  await page.evaluate(async ({ name, bytes }) => {
    await openFiles([new File([new Uint8Array(bytes)], name)]);
  }, { name, bytes: [...bytes] });
}

function readSample(name) {
  return fs.readFileSync(path.join(SAMPLES, name));
}

module.exports = { launchViewer, openBytes, readSample, VIEWER_URL, SAMPLES };
