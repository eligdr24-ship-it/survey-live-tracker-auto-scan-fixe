const $ = id => document.getElementById(id);
const todayISO = () => new Date().toISOString().slice(0, 10);
let records = [];
let surveyLinks = [];
let settings = { holdDays: 7, payRate: 1 };
let scanState = { running: false, total: 0, completed: 0, message: '' };
let scanPollTimer = null;
$('submittedAt').value = todayISO();

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json();
}
function applyDB(db) {
  records = db.records || [];
  surveyLinks = db.surveyLinks || [];
  settings = db.settings || settings;
  scanState = db.scanState || scanState;
  $('holdDays').value = settings.holdDays ?? 7;
  $('payRate').value = settings.payRate ?? 1;
  render();
  updateScanStatus();
  manageScanPolling();
}
async function loadData() {
  try { applyDB(await api('/api/data')); }
  catch (err) { alert('Could not load server data. Make sure the Render/Node server is running.'); }
}
async function saveSettings() {
  try {
    applyDB(await api('/api/settings', { method: 'POST', body: JSON.stringify({ holdDays: $('holdDays').value, payRate: $('payRate').value }) }));
  } catch (err) { console.error(err); }
}
function daysBetween(date) {
  const start = new Date((date || todayISO()) + 'T00:00:00');
  const now = new Date();
  return Math.floor((now - start) / (1000 * 60 * 60 * 24));
}
function computedStatus(r) {
  if (r.status === 'Deleted') return 'Deleted';
  if (r.status === 'Approved') return 'Approved';
  const hold = Number($('holdDays').value || 7);
  return daysBetween(r.submittedAt) >= hold ? 'Approved' : 'Pending';
}
function money(n) { return '$' + Number(n).toFixed(2); }
function escapeHTML(str='') { return String(str).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function escapeAttr(str='') { return escapeHTML(str); }
function isLikelyUrl(str='') { return /^https?:\/\//i.test(String(str).trim()); }
function formatDateTime(value='') {
  if (!value) return 'Never';
  const d = new Date(value);
  return isNaN(d) ? value : d.toLocaleString();
}
function updateScanStatus() {
  if (!$('uploadStatus')) return;
  if (scanState && scanState.running) {
    $('uploadStatus').textContent = `${scanState.message || 'Scanning links backstage...'} Keep this page open or come back later; the server keeps working.`;
    if ($('autoCheckBtn')) $('autoCheckBtn').disabled = true;
  } else if (scanState && scanState.finishedAt && scanState.message) {
    const live = surveyLinks.filter(l => l.checkStatus === 'Live').length;
    const notLive = surveyLinks.filter(l => l.checkStatus === 'Not Live').length;
    const broken = surveyLinks.filter(l => l.checkStatus === 'Broken').length;
    const unknown = surveyLinks.filter(l => ['Unknown', 'Queued', 'Checking'].includes(l.checkStatus)).length;
    $('uploadStatus').textContent = `${scanState.message} Live: ${live}. Not Live: ${notLive}. Broken: ${broken}. Unknown/queued/checking: ${unknown}.`;
    if ($('autoCheckBtn')) $('autoCheckBtn').disabled = false;
  } else {
    if ($('autoCheckBtn')) $('autoCheckBtn').disabled = false;
  }
}
function manageScanPolling() {
  if (scanState && scanState.running && !scanPollTimer) {
    scanPollTimer = setInterval(loadData, 4000);
  }
  if ((!scanState || !scanState.running) && scanPollTimer) {
    clearInterval(scanPollTimer);
    scanPollTimer = null;
  }
}
function addedBadge(l) {
  if (!l.addedToTracker) return '';
  return `<br><span class="badge Approved">Added to Tracker</span><br><small>Worked: ${formatDateTime(l.addedToTrackerAt || l.workedAt)}</small>`;
}
function linkStatusBadge(status='Not Checked') {
  const safe = escapeHTML(status);
  const cls = status === 'Live' ? 'Approved' : ['Broken', 'Not Live'].includes(status) ? 'Deleted' : ['Checking', 'Queued'].includes(status) ? 'Pending' : 'Unknown';
  return `<span class="badge ${cls}">${safe}</span>`;
}

function render() {
  const hold = Number($('holdDays').value || 7);
  const rate = Number($('payRate').value || 0);
  const filter = $('statusFilter').value;
  const q = $('searchBox').value.toLowerCase();
  const tbody = $('rows');
  tbody.innerHTML = '';

  let total = records.length, pending = 0, live = 0, deleted = 0, payable = 0;
  records.forEach(r => {
    const status = computedStatus(r);
    if (status === 'Pending') pending++;
    if (status === 'Approved') { live++; payable += rate; }
    if (status === 'Deleted') deleted++;
  });

  $('totalCount').textContent = total;
  $('pendingCount').textContent = pending;
  $('liveCount').textContent = live;
  $('deletedCount').textContent = deleted;
  $('payableAmount').textContent = money(payable);
  $('linkCount').textContent = surveyLinks.length;
  $('linkLiveCount').textContent = surveyLinks.filter(l => l.checkStatus === 'Live').length;
  $('linkBrokenCount').textContent = surveyLinks.filter(l => ['Broken', 'Not Live'].includes(l.checkStatus)).length;

  const filteredRecords = records
    .filter(r => filter === 'all' || computedStatus(r) === filter)
    .filter(r => [r.worker, r.participant, r.surveyLink].join(' ').toLowerCase().includes(q))
    .sort((a,b) => new Date(b.submittedAt) - new Date(a.submittedAt));

  if (!filteredRecords.length) tbody.innerHTML = '<tr><td colspan="8" class="empty">No submissions yet.</td></tr>';

  filteredRecords.forEach(r => {
    const status = computedStatus(r);
    const age = daysBetween(r.submittedAt);
    const payment = status === 'Approved' ? money(rate) : '$0.00';
    const linkHTML = r.surveyLink ? (isLikelyUrl(r.surveyLink) ? `<a href="${escapeAttr(r.surveyLink)}" target="_blank">${escapeHTML(r.surveyLink)}</a>` : escapeHTML(r.surveyLink)) : '<small>No link</small>';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHTML(r.worker)}</strong></td>
      <td>${escapeHTML(r.participant)}</td>
      <td>${linkHTML}</td>
      <td>${escapeHTML(r.submittedAt)}</td>
      <td>${age} day${age === 1 ? '' : 's'}<br><small>${Math.max(hold - age, 0)} days until payable</small></td>
      <td><span class="badge ${status}">${status}</span></td>
      <td>${payment}</td>
      <td class="actions">
        <button class="good" onclick="markLive('${r.id}')">Mark Live</button>
        <button class="bad" onclick="markDeleted('${r.id}')">Deleted</button>
        <button class="secondary" onclick="removeRecord('${r.id}')">Remove</button>
      </td>`;
    tbody.appendChild(tr);
  });
  renderLinks();
}

function renderLinks() {
  const q = $('linkSearchBox').value.toLowerCase();
  const tbody = $('linkRows');
  tbody.innerHTML = '';
  const rows = surveyLinks.filter(l => [l.surveyLink, l.worker, l.participant, l.submittedAt, l.notes].join(' ').toLowerCase().includes(q));
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">No uploaded links yet. Upload an Excel or CSV sheet above.</td></tr>';
    return;
  }
  rows.forEach((l, idx) => {
    const linkHTML = isLikelyUrl(l.surveyLink) ? `<a href="${escapeAttr(l.surveyLink)}" target="_blank">${escapeHTML(l.surveyLink)}</a>` : escapeHTML(l.surveyLink || '');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="checkbox" class="link-select" value="${escapeAttr(l.id)}" /> ${idx + 1}</td>
      <td>${linkHTML}</td>
      <td>${escapeHTML(l.worker || '')}</td>
      <td>${escapeHTML(l.participant || '')}</td>
      <td>${escapeHTML(l.submittedAt || '')}</td>
      <td>${escapeHTML(l.notes || '')}</td>
      <td>${linkStatusBadge(l.checkStatus || 'Not Checked')}${addedBadge(l)}<br><small>${escapeHTML(l.checkMessage || '')}</small></td>
      <td><small>${formatDateTime(l.lastCheckedAt)}</small></td>
      <td class="actions">
        <button class="primary" onclick="openLink('${l.id}')">Open Link</button>
        <button class="good" ${l.addedToTracker ? 'disabled title="Already added to tracker"' : ''} onclick="addLinkToSubmissions('${l.id}')">${l.addedToTracker ? 'Added' : 'Add to Tracker'}</button>
        <button class="secondary" onclick="checkOneLink('${l.id}')">Check</button>
        <button class="secondary" onclick="copyLink('${l.id}')">Copy</button>
        <button class="bad" onclick="removeLink('${l.id}')">Remove</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

function normalizeHeader(h='') { return String(h).trim().toLowerCase().replace(/[^a-z0-9]/g, ''); }
function pick(row, names) {
  const wanted = names.map(normalizeHeader);
  for (const key of Object.keys(row)) if (wanted.includes(normalizeHeader(key))) return row[key];
  return '';
}
function normalizeDate(value) {
  if (!value) return '';
  if (value instanceof Date && !isNaN(value)) return value.toISOString().slice(0,10);
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d) ? s : d.toISOString().slice(0,10);
}
function csvToObjects(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
  if (!lines.length) return [];
  const parseLine = line => {
    const out = []; let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = !inQuotes;
      else if (ch === ',' && !inQuotes) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(x => x.trim());
  };
  const headers = parseLine(lines[0]);
  return lines.slice(1).map(line => {
    const vals = parseLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] || '']));
  });
}
function rowsToLinks(rows) {
  return rows.map(row => ({
    surveyLink: String(pick(row, ['Survey Link', 'SurveyLink', 'Link', 'URL', 'Survey URL', 'Record ID']) || '').trim(),
    worker: String(pick(row, ['Worker', 'Affiliate', 'Worker Name', 'Affiliate Name']) || '').trim(),
    participant: String(pick(row, ['Participant', 'Participant ID', 'Email', 'Phone', 'Customer']) || '').trim(),
    submittedAt: normalizeDate(pick(row, ['Submitted Date', 'Submitted At', 'Date', 'Created At'])),
    notes: String(pick(row, ['Notes', 'Note', 'Status']) || '').trim()
  })).filter(l => l.surveyLink);
}

$('addBtn').onclick = async () => {
  const worker = $('worker').value.trim();
  const participant = $('participant').value.trim();
  const surveyLink = $('surveyLink').value.trim();
  const submittedAt = $('submittedAt').value || todayISO();
  if (!worker || !participant) return alert('Please add worker and participant fields.');
  try {
    applyDB(await api('/api/records', { method: 'POST', body: JSON.stringify({ worker, participant, surveyLink, submittedAt }) }));
    ['worker','participant','surveyLink'].forEach(id => $(id).value = '');
    $('submittedAt').value = todayISO();
  } catch (err) { alert('Could not add record.'); }
};

$('uploadLinksBtn').onclick = async () => {
  const file = $('linkFile').files[0];
  if (!file) return alert('Please choose an Excel or CSV file first.');
  const ext = file.name.split('.').pop().toLowerCase();
  let imported = [];
  try {
    if (ext === 'csv') imported = rowsToLinks(csvToObjects(await file.text()));
    else {
      if (!window.XLSX) return alert('Excel upload needs internet because the XLSX reader loads from CDN. Save as CSV if needed.');
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      imported = rowsToLinks(XLSX.utils.sheet_to_json(sheet, { defval: '' }));
    }
  } catch (err) {
    console.error(err);
    return alert('Could not read this file. Please check the column names or try CSV.');
  }
  if (!imported.length) return alert('No survey links found. Use a column named Survey Link, Link, URL, Survey URL, or Record ID.');
  try {
    const db = await api('/api/links/import', { method: 'POST', body: JSON.stringify({ links: imported }) });
    $('uploadStatus').textContent = `Imported ${db.imported} new links. Skipped ${db.skipped} duplicates.`;
    $('linkFile').value = '';
    applyDB(db);
  } catch (err) { alert('Upload failed.'); }
};

window.openLink = id => {
  const l = surveyLinks.find(x => x.id === id);
  if (!l || !l.surveyLink) return;
  window.open(l.surveyLink, '_blank', 'noopener,noreferrer');
};
window.addLinkToSubmissions = async id => {
  const l = surveyLinks.find(x => x.id === id);
  if (!l) return;
  const worker = l.worker || prompt('Worker / Affiliate name?') || '';
  const participant = l.participant || prompt('Participant ID / phone / email?') || '';
  if (!worker || !participant) return alert('Worker and participant are required.');
  try { applyDB(await api(`/api/links/${id}/add-to-tracker`, { method: 'POST', body: JSON.stringify({ worker, participant }) })); }
  catch (err) { alert('Could not add link to tracker.'); }
};
window.copyLink = async id => {
  const l = surveyLinks.find(x => x.id === id);
  if (!l) return;
  await navigator.clipboard.writeText(l.surveyLink);
  alert('Link copied.');
};
window.removeLink = async id => { if(confirm('Remove this uploaded link?')) applyDB(await api(`/api/links/${id}`, { method: 'DELETE' })); };
window.markDeleted = async id => applyDB(await api(`/api/records/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'Deleted' }) }));
window.markLive = async id => applyDB(await api(`/api/records/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'Approved' }) }));
window.removeRecord = async id => { if(confirm('Remove this record?')) applyDB(await api(`/api/records/${id}`, { method: 'DELETE' })); };
window.checkOneLink = async id => {
  const item = surveyLinks.find(l => l.id === id);
  if (item) { item.checkStatus = 'Queued'; item.checkMessage = 'Added to backstage check queue...'; render(); }
  try { applyDB(await api(`/api/links/${id}/check`, { method: 'POST' })); }
  catch (err) { alert('Check failed. The server may be blocked by the survey website.'); await loadData(); }
};
async function autoCheckLinks() {
  if (!surveyLinks.filter(l => isLikelyUrl(l.surveyLink)).length) return alert('No valid http/https links to check.');
  $('uploadStatus').textContent = `Starting backstage auto scan for all links...`;
  $('autoCheckBtn').disabled = true;
  try {
    applyDB(await api('/api/links/check-all', { method: 'POST' }));
  } catch (err) {
    $('uploadStatus').textContent = 'Could not start auto check. Try again or check Render logs.';
    $('autoCheckBtn').disabled = false;
  }
}
async function checkSelectedLinks() {
  const ids = Array.from(document.querySelectorAll('.link-select:checked')).map(x => x.value);
  if (!ids.length) return alert('Select at least one link first.');
  $('uploadStatus').textContent = `Starting backstage scan for ${ids.length} selected links...`;
  try {
    applyDB(await api('/api/links/check-selected', { method: 'POST', body: JSON.stringify({ ids }) }));
  } catch (err) {
    $('uploadStatus').textContent = 'Could not start selected check. Try again or check Render logs.';
  }
}
function selectAllVisibleLinks() {
  const boxes = Array.from(document.querySelectorAll('.link-select'));
  const shouldCheck = boxes.some(b => !b.checked);
  boxes.forEach(b => b.checked = shouldCheck);
}

function downloadCSV(filename, headers, rows) {
  const csv = [headers.join(',')].concat(rows.map(row => row.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(','))).join('\n');
  const blob = new Blob([csv], {type: 'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}
$('downloadTemplateBtn').onclick = () => downloadCSV('survey-links-template.csv', ['Survey Link','Worker','Participant','Submitted Date','Notes'], [['https://example.com/survey/123','John Affiliate','participant-001',todayISO(),'Example row']]);
$('exportLinksBtn').onclick = () => downloadCSV('uploaded-survey-links.csv', ['Survey Link','Worker','Participant','Submitted Date','Notes','Check Status','Check Message','HTTP Status','Last Checked','Added To Tracker','Added At'], surveyLinks.map(l => [l.surveyLink,l.worker,l.participant,l.submittedAt,l.notes,l.checkStatus,l.checkMessage,l.httpStatus,l.lastCheckedAt,l.addedToTracker ? 'Yes' : 'No',l.addedToTrackerAt || '']));
$('exportBtn').onclick = () => {
  const rate = Number($('payRate').value || 0);
  downloadCSV('survey-live-tracker-export.csv', ['worker','participant','surveyLink','submittedAt','ageDays','status','payment'], records.map(r => {
    const status = computedStatus(r);
    return [r.worker, r.participant, r.surveyLink, r.submittedAt, daysBetween(r.submittedAt), status, status === 'Approved' ? rate.toFixed(2) : '0.00'];
  }));
};
$('autoCheckBtn').onclick = autoCheckLinks;
if ($('checkSelectedBtn')) $('checkSelectedBtn').onclick = checkSelectedLinks;
if ($('selectAllLinksBtn')) $('selectAllLinksBtn').onclick = selectAllVisibleLinks;
$('clearLinksBtn').onclick = async () => { if(confirm('Delete all uploaded links from the server?')) applyDB(await api('/api/links', { method: 'DELETE' })); };
$('clearBtn').onclick = async () => { if(confirm('Delete all records from the server?')) applyDB(await api('/api/records', { method: 'DELETE' })); };
$('holdDays').addEventListener('change', saveSettings);
$('payRate').addEventListener('change', saveSettings);
['statusFilter','searchBox','linkSearchBox'].forEach(id => $(id).addEventListener('input', render));
loadData();
setInterval(loadData, 60000);
