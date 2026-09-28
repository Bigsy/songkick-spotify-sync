// Renders Chrome Web Store assets from the real sync page with fictional demo data.
// Usage: node store/render.mjs   (needs Google Chrome, ImageMagick and rsvg-convert)
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';

const run = promisify(execFile);
const root = new URL('..', import.meta.url).pathname;
const out = join(root, 'store', 'out');
const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

const server = createServer(async (request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url, 'http://localhost').pathname)).replace(/^(\.\.[/\\])+/, '');
  try {
    let body = await readFile(join(root, path));
    if (path === '/sync.html') body = String(body).replace('<script type="module"', '<script src="/store/demo.js"></script>\n  <script type="module"');
    response.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' });
    response.end(body);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

async function shoot(query, width, height, file) {
  const profile = await mkdtemp(join(tmpdir(), 'store-render-'));
  const raw = join(profile, 'shot.png');
  try {
    // Headless Chrome writes the screenshot but its updater can keep the process alive,
    // so wait for the file to settle and then close Chrome.
    const browser = spawn(chrome, ['--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--no-first-run',
      '--disable-background-networking', '--disable-component-update', `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`, '--virtual-time-budget=6000', `--screenshot=${raw}`, `${base}/store/frame.html?${query}`], { stdio: 'ignore' });
    let size = -1;
    for (let i = 0; i < 120; i++) {
      await new Promise(resolve => setTimeout(resolve, 250));
      const current = await stat(raw).then(info => info.size, () => -1);
      if (current > 0 && current === size) break;
      size = current;
    }
    browser.kill();
    if (size <= 0) throw new Error(`No screenshot for ${file}`);
    // The store wants JPEG or 24-bit PNG without alpha.
    await run('magick', [raw, '-background', '#101612', '-alpha', 'remove', '-alpha', 'off', `PNG24:${join(out, file)}`]);
    console.log('wrote', file);
  } finally { await rm(profile, { recursive: true, force: true }); }
}

await mkdir(out, { recursive: true });
for (const n of [16, 32, 48, 128]) {
  const svg = join(root, 'store', n === 128 ? 'icon.svg' : 'icon-toolbar.svg');
  await run('rsvg-convert', ['-w', String(n), '-h', String(n), svg, '-o', join(root, 'icons', `icon${n}.png`)]);
}
await run('cp', [join(root, 'icons', 'icon128.png'), join(out, 'store-icon-128.png')]);
const shots = ['needs', 'choose', 'progress', 'none'];
for (const [i, shot] of shots.entries()) await shoot(`kind=shot&shot=${shot}`, 1280, 800, `screenshot-${i + 1}-${shot}.png`);
await shoot('kind=small', 440, 280, 'promo-small-440x280.png');
await shoot('kind=marquee', 1400, 560, 'promo-marquee-1400x560.png');
server.close();
