const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');

let puppeteer = null;
let chromium = null;
try {
  puppeteer = require('puppeteer-core');
  chromium = require('@sparticuz/chromium');
} catch (e) {
  console.warn('Browser checker dependencies not loaded:', e.message);
}

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'database.json');
// Link scans are manual only. The server will not auto-scan until the admin clicks Check All or Check Selected.

const scanState = {
  running: false,
  total: 0,
  completed: 0,
  startedAt: '',
  finishedAt: '',
  reason: '',
  message: 'No scan running'
};

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ records: [], surveyLinks: [], settings: { holdDays: 7, payRate: 1 } }, null, 2));
  }
}
function readDB() {
  ensureDataFile();
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return { records: [], surveyLinks: [], settings: { holdDays: 7, payRate: 1 } }; }
}
function writeDB(db) {
  ensureDataFile();
  const temp = DATA_FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(db, null, 2));
  fs.renameSync(temp, DATA_FILE);
}
function id() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
function todayISO() { return new Date().toISOString().slice(0, 10); }
function cleanUrl(url) { return String(url || '').trim(); }
function isLikelyUrl(url) { return /^https?:\/\//i.test(String(url || '').trim()); }

function requestUrl(url, method = 'HEAD', timeoutMs = 15000, readBody = false) {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(url); } catch { return resolve({ status: 'Unknown', message: 'Invalid URL' }); }
    if (!['http:', 'https:'].includes(parsed.protocol)) return resolve({ status: 'Unknown', message: 'Only http/https supported' });

    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(parsed, {
      method,
      timeout: timeoutMs,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SurveyLiveTracker/3.0; +https://render.com)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    }, (res) => {
      let body = '';
      const maxBytes = 1024 * 1024;
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        if (readBody && body.length < maxBytes) body += chunk;
      });
      res.on('end', () => {
        resolve({ httpStatus: res.statusCode, finalUrl: res.headers.location || url, headers: res.headers, body });
      });
      if (!readBody) res.resume();
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 'Unknown', message: 'Timeout / no response' }); });
    req.on('error', (err) => resolve({ status: 'Broken', message: err.code || err.message }));
    req.end();
  });
}

function classify(result) {
  if (result.status) return result;
  const code = Number(result.httpStatus || 0);
  const bodyText = String(result.body || '').toLowerCase().replace(/\s+/g, ' ');

  const notLivePhrases = [
    'this review is no longer available',
    'review is no longer available',
    'review no longer available',
    'no longer available.',
    'no longer available',
    'survey is no longer available',
    'this survey is no longer available',
    'form is no longer available',
    'this form is no longer available',
    'survey closed',
    'this survey has closed',
    'survey unavailable',
    'link expired',
    'this study has ended',
    'this form is no longer accepting responses',
    'content unavailable',
    'review not found',
    'page not found'
  ];

  const phrase = notLivePhrases.find(p => bodyText.includes(p));
  if (phrase) return { status: 'Not Live', httpStatus: code || '', message: `Page opened, but contains: ${phrase}` };

  if (code >= 200 && code < 400) return { status: 'Live', httpStatus: code, message: `HTTP ${code}` };
  if ([401, 403, 405, 429].includes(code)) return { status: 'Unknown', httpStatus: code, message: `Blocked/protected: HTTP ${code}` };
  if (code >= 400) return { status: 'Broken', httpStatus: code, message: `HTTP ${code}` };
  return { status: 'Unknown', httpStatus: code || '', message: 'No clear response' };
}


async function browserCheckUrl(url, timeoutMs = 60000) {
  if (!puppeteer || !chromium) {
    return { status: 'Unknown', method: 'Browser', message: 'Browser checker not available. puppeteer-core/@sparticuz/chromium is not installed.' };
  }

  let browser;
  try {
    const executablePath = await chromium.executablePath();
    if (!executablePath) {
      return { status: 'Unknown', method: 'Browser', message: 'Chromium executable path not found on Render.' };
    }

    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote'
      ],
      defaultViewport: { width: 1365, height: 900 },
      executablePath,
      headless: chromium.headless,
      ignoreHTTPSErrors: true
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' });

    let response = null;
    try {
      response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    } catch (gotoErr) {
      try { await page.waitForSelector('body', { timeout: 10000 }); } catch {}
    }

    // Google Maps often changes the visible message a few seconds after redirect/render.
    await new Promise(resolve => setTimeout(resolve, 8000));

    const visibleText = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
    const htmlText = await page.content().catch(() => '');
    const finalUrl = page.url();
    const httpStatus = response ? response.status() : '';
    const combined = `${visibleText}\n${htmlText}\n${finalUrl}`;
    const classified = classify({ httpStatus, finalUrl, body: combined });

    if (classified.status === 'Not Live') {
      return { ...classified, finalUrl, method: 'Browser + phrase match', message: `Matched phrase by browser: ${classified.message}` };
    }

    if (/maps\.app\.goo\.gl|google\.com\/maps|goo\.gl/i.test(url) || /google\.com\/maps/i.test(finalUrl)) {
      if (!visibleText && !htmlText) return { status: 'Unknown', httpStatus, finalUrl, method: 'Browser', message: 'Browser opened page but could not read text' };
      if (httpStatus && httpStatus >= 400) return { status: 'Broken', httpStatus, finalUrl, method: 'Browser', message: `Browser check HTTP ${httpStatus}` };
      return { status: 'Live', httpStatus: httpStatus || 200, finalUrl, method: 'Browser', message: `Browser check completed. Final URL checked.` };
    }

    return { ...classified, finalUrl, method: 'Browser', message: classified.message || 'Browser check completed' };
  } catch (err) {
    return { status: 'Unknown', method: 'Browser', message: `Browser check failed: ${err.message}` };
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}

async function checkUrl(url) {
  const checkedAt = new Date().toISOString();
  if (!isLikelyUrl(url)) return { status: 'Unknown', message: 'Not a valid http/https URL', checkedAt };

  const isGoogleMaps = /maps\.app\.goo\.gl|google\.com\/maps|goo\.gl/i.test(url);

  // Google Maps/review links must be checked with a real browser. A raw HTTP 302 redirect is not proof that the review is live.
  if (isGoogleMaps) {
    const browserResult = await browserCheckUrl(url);
    if (browserResult.status === 'Not Live') return { ...browserResult, checkedAt };
    if (browserResult.status === 'Live') return { ...browserResult, checkedAt };
    return { ...browserResult, status: 'Unknown', checkedAt, message: `${browserResult.message || 'Browser check failed'} — Google Maps 302 is not treated as Live.` };
  }

  let result = await requestUrl(url, 'HEAD');
  let classified = classify(result);

  // GET is needed to scan page text for “no longer available”. Some websites also reject HEAD.
  if (classified.status === 'Live' || classified.status === 'Unknown' || [403, 405, 429].includes(Number(result.httpStatus))) {
    result = await requestUrl(url, 'GET', 20000, true);
    classified = classify(result);
  }

  if (classified.status === 'Live' || classified.status === 'Unknown') {
    const browserResult = await browserCheckUrl(url);
    if (browserResult.status === 'Not Live') return { ...browserResult, checkedAt };
  }

  return { ...classified, checkedAt };
}

function publicDB() {
  const db = readDB();
  return {
    settings: db.settings || { holdDays: 7, payRate: 1 },
    records: db.records || [],
    surveyLinks: db.surveyLinks || [],
    scanState: { ...scanState }
  };
}

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.get('/api/data', (req, res) => res.json(publicDB()));

app.post('/api/settings', (req, res) => {
  const db = readDB();
  db.settings = {
    holdDays: Number(req.body.holdDays || db.settings?.holdDays || 7),
    payRate: Number(req.body.payRate || db.settings?.payRate || 1)
  };
  writeDB(db);
  res.json(publicDB());
});

app.post('/api/records', (req, res) => {
  const db = readDB();
  const r = {
    id: id(),
    worker: String(req.body.worker || '').trim(),
    participant: String(req.body.participant || '').trim(),
    surveyLink: cleanUrl(req.body.surveyLink),
    submittedAt: String(req.body.submittedAt || todayISO()).slice(0, 10),
    status: req.body.status || 'Pending',
    createdAt: new Date().toISOString()
  };
  if (!r.worker || !r.participant) return res.status(400).json({ error: 'Worker and participant are required' });
  db.records = db.records || [];
  db.records.push(r);
  writeDB(db);
  res.json(publicDB());
});

app.patch('/api/records/:id', (req, res) => {
  const db = readDB();
  db.records = (db.records || []).map(r => r.id === req.params.id ? { ...r, ...req.body, updatedAt: new Date().toISOString() } : r);
  writeDB(db);
  res.json(publicDB());
});

app.delete('/api/records/:id', (req, res) => {
  const db = readDB();
  db.records = (db.records || []).filter(r => r.id !== req.params.id);
  writeDB(db);
  res.json(publicDB());
});

app.delete('/api/records', (req, res) => {
  const db = readDB();
  db.records = [];
  writeDB(db);
  res.json(publicDB());
});

app.post('/api/links/import', (req, res) => {
  const db = readDB();
  db.surveyLinks = db.surveyLinks || [];
  const links = Array.isArray(req.body.links) ? req.body.links : [];
  const existing = new Set(db.surveyLinks.map(l => cleanUrl(l.surveyLink)));
  let imported = 0, skipped = 0;
  for (const l of links) {
    const surveyLink = cleanUrl(l.surveyLink);
    if (!surveyLink || existing.has(surveyLink)) { skipped++; continue; }
    existing.add(surveyLink);
    imported++;
    db.surveyLinks.push({
      id: id(),
      surveyLink,
      worker: String(l.worker || '').trim(),
      participant: String(l.participant || '').trim(),
      submittedAt: String(l.submittedAt || '').slice(0, 10),
      notes: String(l.notes || '').trim(),
      checkStatus: 'Not Checked',
      checkMessage: '',
      httpStatus: '',
      lastCheckedAt: '',
      addedToTracker: false,
      addedToTrackerAt: '',
      workedAt: '',
      createdAt: new Date().toISOString()
    });
  }
  writeDB(db);
  res.json({ imported, skipped, ...publicDB() });
});

app.delete('/api/links', (req, res) => {
  const db = readDB();
  db.surveyLinks = [];
  writeDB(db);
  res.json(publicDB());
});

app.delete('/api/links/:id', (req, res) => {
  const db = readDB();
  db.surveyLinks = (db.surveyLinks || []).filter(l => l.id !== req.params.id);
  writeDB(db);
  res.json(publicDB());
});

app.post('/api/links/:id/add-to-tracker', (req, res) => {
  const db = readDB();
  const l = (db.surveyLinks || []).find(x => x.id === req.params.id);
  if (!l) return res.status(404).json({ error: 'Link not found' });
  const worker = String(req.body.worker || l.worker || '').trim();
  const participant = String(req.body.participant || l.participant || '').trim();
  if (!worker || !participant) return res.status(400).json({ error: 'Worker and participant are required' });
  db.records = db.records || [];
  db.records.push({ id: id(), worker, participant, surveyLink: l.surveyLink, submittedAt: l.submittedAt || todayISO(), status: 'Pending', createdAt: new Date().toISOString() });
  l.addedToTracker = true;
  l.addedToTrackerAt = new Date().toISOString();
  l.workedAt = l.addedToTrackerAt;
  writeDB(db);
  res.json(publicDB());
});

app.post('/api/check-link', async (req, res) => {
  const url = cleanUrl(req.body?.url);
  if (!url) return res.status(400).json({ status: 'Unknown', message: 'Missing URL' });
  res.json({ url, ...(await checkUrl(url)) });
});

app.post('/api/links/:id/check', (req, res) => {
  const db = readDB();
  const link = (db.surveyLinks || []).find(l => l.id === req.params.id);
  if (!link) return res.status(404).json({ error: 'Link not found' });
  const started = startScanJob({ ids: [req.params.id], reason: 'manual-single-check' });
  res.json({ started, message: started ? 'Backstage check started.' : 'A scan is already running.', ...publicDB() });
});


async function runScanJob({ ids = null, reason = 'manual' } = {}) {
  if (scanState.running) return false;
  scanState.running = true;
  scanState.startedAt = new Date().toISOString();
  scanState.finishedAt = '';
  scanState.reason = reason;
  scanState.completed = 0;
  scanState.message = 'Starting scan...';

  try {
    const db = readDB();
    let links = db.surveyLinks || [];
    if (Array.isArray(ids) && ids.length) {
      const idSet = new Set(ids);
      links = links.filter(l => idSet.has(l.id));
    }

    scanState.total = links.length;
    scanState.message = links.length ? `Scanning 0 of ${links.length} links...` : 'No links to scan.';

    // Mark selected links as queued so the dashboard immediately shows progress.
    const queuedIds = new Set(links.map(l => l.id));
    for (const link of (db.surveyLinks || [])) {
      if (queuedIds.has(link.id)) {
        link.checkStatus = 'Queued';
        link.checkMessage = 'Waiting for backstage auto scan...';
      }
    }
    writeDB(db);

    for (const linkInfo of links) {
      const freshDb = readDB();
      const link = (freshDb.surveyLinks || []).find(l => l.id === linkInfo.id);
      if (!link) continue;

      link.checkStatus = 'Checking';
      link.checkMessage = `Backstage scan running (${scanState.completed + 1}/${scanState.total})...`;
      writeDB(freshDb);

      const result = await checkUrl(link.surveyLink);
      const afterDb = readDB();
      const afterLink = (afterDb.surveyLinks || []).find(l => l.id === linkInfo.id);
      if (afterLink) {
        afterLink.checkStatus = result.status;
        afterLink.checkMessage = result.message || '';
        afterLink.httpStatus = result.httpStatus || '';
        afterLink.finalUrl = result.finalUrl || '';
        afterLink.checkMethod = result.method || '';
        afterLink.lastCheckedAt = result.checkedAt;
        writeDB(afterDb);
      }
      scanState.completed += 1;
      scanState.message = `Scanning ${scanState.completed} of ${scanState.total} links...`;
      await new Promise(r => setTimeout(r, 500));
    }

    scanState.message = `Finished scanning ${scanState.completed} of ${scanState.total} links.`;
  } catch (err) {
    console.error('Scan job failed:', err);
    scanState.message = `Scan failed: ${err.message}`;
  } finally {
    scanState.running = false;
    scanState.finishedAt = new Date().toISOString();
  }
  return true;
}

function startScanJob(options) {
  if (scanState.running) return false;
  runScanJob(options).catch(err => {
    console.error('Background scan crashed:', err);
    scanState.running = false;
    scanState.finishedAt = new Date().toISOString();
    scanState.message = `Scan crashed: ${err.message}`;
  });
  return true;
}

app.get('/api/scan/status', (req, res) => res.json({ ...scanState }));

app.post('/api/links/check-all', (req, res) => {
  const started = startScanJob({ reason: 'manual-auto-check' });
  res.json({ started, message: started ? 'Backstage auto scan started.' : 'A scan is already running.', ...publicDB() });
});

app.post('/api/links/check-selected', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (!ids.length) return res.status(400).json({ error: 'No link IDs selected' });
  const started = startScanJob({ ids, reason: 'manual-selected-check' });
  res.json({ started, message: started ? `Backstage scan started for ${ids.length} selected links.` : 'A scan is already running.', ...publicDB() });
});


app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

ensureDataFile();
app.listen(PORT, () => console.log(`Survey Live Tracker running on port ${PORT}`));
