'use strict';
/* global browser, MarjaneExport, MarjaneCapture, MarjaneAutomation */
const MAX_RESPONSE = 2 * 1024 * 1024;
const MAX_SESSION = 10 * 1024 * 1024;
const MAX_RECORDS = 2000;
const URLS = ['https://api-ayaline.marjane.ma/*', 'https://www.marjane.ma/*', 'https://marjane.ma/*'];
let tabId = null;
let epoch = 0;
let records = new Map();
let byteCount = 0;
let responses = 0;
let skipped = 0;
let errors = 0;
let notice = 'Nothing captured yet.';
const streams = new Map();
const downloadUrls = new Map();
let automation = null;

function stopAutomation() {
  if (automation) automation.running = false;
}

async function ticketControl(id, command, extra = {}) {
  const result = await browser.tabs.sendMessage(id, {type: 'marjane-ticket-control', command, ...extra}, {frameId: 0});
  if (!result?.ok) throw new Error(result?.error || 'Could not control the history page.');
  return result;
}

async function startAutomation() {
  if (tabId === null) throw new Error('Start capture and refresh En magasin first.');
  if (automation?.running) throw new Error('Ticket loading is already running.');
  const [active] = await browser.tabs.query({active: true, currentWindow: true});
  if (active?.id !== tabId) throw new Error('Select the Marjane tab being captured first.');
  const id = tabId;
  const session = epoch;
  const run = {running: true, total: 0, completed: 0, attempted: 0};
  automation = run;
  try {
    const tickets = [...records.values()].filter(record => record.type === 'in-store' && !record.detailsLoaded)
      .map(record => ({id: record.id, storeId: record.storeId}));
    if (!tickets.length) throw new Error('No pending tickets captured. Refresh En magasin first, or export the details already loaded.');
    await browser.tabs.executeScript(id, {file: '/detail-controls.js', frameId: 0});
    if (!run.running || epoch !== session) return;
    const result = await ticketControl(id, 'discover', {tickets});
    if (!run.running || epoch !== session) return;
    if (!result.tickets.length) throw new Error('No matching ticket cards found. Select En magasin and refresh while capture is on.');
    run.total = result.tickets.length;
    notice = 'Loading ticket details one at a time. Keep this history tab visible.';
    // Do not hold the popup request open for the duration of automation.
    void MarjaneAutomation.collect(result.tickets, {
      current: () => run.running && epoch === session && tabId === id,
      now: () => Date.now(),
      sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
      loaded: ticket => !!records.get(MarjaneExport.key({type: 'in-store', ...ticket}))?.detailsLoaded,
      async open(ticket) {
        const tab = await browser.tabs.get(id);
        if (!run.running || epoch !== session) return;
        if (!tab.active) throw new Error('History tab is no longer active. Automation stopped.');
        await ticketControl(id, 'open', {ticket});
      },
      close: ticket => ticketControl(id, 'close', {ticket}),
      progress: progress => Object.assign(run, progress)
    }).then(result => {
      if (epoch === session && run.running) notice = result.reason === 'complete' ?
        'Ticket details loaded. Export JSON or CSV; load another history page to collect more.' : 'Ticket loading stopped.';
    }).catch(() => {
      if (epoch === session && run.running) notice = 'Ticket loading stopped: a response timed out or the page changed. Close any open ticket, check the page, and retry. Capture and export still work.';
    }).finally(() => { run.running = false; });
  } catch (error) {
    run.running = false;
    throw error;
  }
}

function pause(message) {
  stopAutomation();
  epoch++;
  tabId = null;
  for (const stop of streams.values()) stop();
  streams.clear();
  notice = message;
  browser.browserAction.setBadgeText({text: ''}).catch(() => {});
}
function reset() {
  pause('Capture cleared.');
  records = new Map();
  byteCount = responses = skipped = errors = 0;
}
function status() {
  const values = [...records.values()];
  return {capturing: tabId !== null, responses, skipped, errors, notice,
    automation: automation ? {...automation} : null,
    purchases: values.length, detailed: values.filter(record => record.detailsLoaded).length,
    items: values.reduce((sum, record) => sum + record.items.length, 0)};
}
function accept(payload, source, session) {
  if (session !== epoch || tabId === null) return;
  responses++;
  const entries = MarjaneExport.normalize(payload, source);
  if (!entries.length && !(Array.isArray(payload) && payload.length === 0)) skipped++;
  for (const incoming of entries) {
    const id = MarjaneExport.key(incoming);
    const previous = records.get(id);
    const merged = MarjaneExport.merge(previous, incoming);
    const before = previous ? new TextEncoder().encode(JSON.stringify(previous)).length : 0;
    const after = new TextEncoder().encode(JSON.stringify(merged)).length;
    if ((!previous && records.size >= MAX_RECORDS) || byteCount - before + after > MAX_SESSION) {
      pause('Capture limit reached. Export, then start a new capture.');
      return;
    }
    records.set(id, merged);
    byteCount += after - before;
  }
  if (!automation?.running) notice = 'Captured loaded history. Open receipt details or use automatic ticket loading.';
}

browser.webRequest.onHeadersReceived.addListener(details => {
  if (tabId === null || details.tabId !== tabId || details.method !== 'GET' ||
      details.statusCode < 200 || details.statusCode >= 300 || details.incognito) return;
  const source = MarjaneExport.endpoint(details.url);
  if (!source) return;
  if (streams.size >= 16) { skipped++; return; }
  const session = epoch;
  try {
    const filter = browser.webRequest.filterResponseData(details.requestId);
    const done = () => streams.delete(details.requestId);
    const stop = MarjaneCapture.observe(filter, {
      limit: MAX_RESPONSE,
      complete(payload) { done(); accept(payload, source, session); },
      skipped() { done(); if (session === epoch) skipped++; },
      failed() { done(); if (session === epoch) errors++; }
    });
    streams.set(details.requestId, stop);
  } catch (_) {
    errors++;
    notice = 'Firefox could not observe a response. The request was left unchanged.';
  }
}, {urls: URLS, types: ['xmlhttprequest']}, ['blocking']);

browser.tabs.onRemoved.addListener(id => { if (id === tabId) pause('Marjane tab closed. Captured data remains until Clear or browser exit.'); });
browser.tabs.onUpdated.addListener((id, change) => {
  if (id !== tabId || !change.url) return;
  try {
    const url = new URL(change.url);
    if (url.pathname.replace(/\/$/, '') !== '/account/orders') stopAutomation();
    if (url.protocol !== 'https:' || !['www.marjane.ma', 'marjane.ma'].includes(url.hostname)) {
      pause('Capture paused after leaving Marjane.');
    }
  } catch (_) { pause('Capture paused.'); }
});
browser.tabs.onActivated.addListener(info => {
  if (automation?.running && info.tabId !== tabId) {
    stopAutomation();
    notice = 'Ticket loading stopped after switching tabs. Capture remains on.';
  }
});

browser.downloads.onChanged.addListener(delta => {
  if (!['complete', 'interrupted'].includes(delta.state?.current)) return;
  const url = downloadUrls.get(delta.id);
  if (url) { URL.revokeObjectURL(url); downloadUrls.delete(delta.id); }
});

browser.runtime.onMessage.addListener(async (message, sender) => {
  // Popup only, not website/content-script messages.
  if (sender.id !== browser.runtime.id || sender.tab) return undefined;
  switch (message?.action) {
    case 'status': return status();
    case 'start': {
      const [tab] = await browser.tabs.query({active: true, currentWindow: true});
      let url;
      try { url = new URL(tab?.url); } catch (_) { throw new Error('Open a Marjane tab first.'); }
      if (url.protocol !== 'https:' || !['www.marjane.ma', 'marjane.ma'].includes(url.hostname)) {
        throw new Error('Select the signed-in marjane.ma tab first.');
      }
      if (tab.incognito) throw new Error('Private-window capture is not supported.');
      reset();
      tabId = tab.id;
      notice = 'Recording this tab only. Refresh history, load pages, and open receipt details.';
      await browser.browserAction.setBadgeBackgroundColor({color: '#075ba8'});
      await browser.browserAction.setBadgeText({text: 'ON'});
      return status();
    }
    case 'pause': pause('Capture paused. You can still export.'); return status();
    case 'clear': reset(); return status();
    case 'load-details': await startAutomation(); return status();
    case 'stop-details':
      stopAutomation();
      notice = 'Automatic ticket loading stopped. Any open ticket is left for you to close. You can export captured details.';
      return status();
    case 'export': {
      if (!['json', 'csv'].includes(message.format)) throw new Error('Unsupported export format.');
      const purchases = [...records.values()];
      if (!purchases.length) throw new Error('No purchases captured. Start capture, then refresh history.');
      const now = new Date().toISOString();
      const content = message.format === 'json' ? JSON.stringify({
        formatVersion: 1, exportedAt: now,
        scope: 'Only history loaded while capture was enabled; not necessarily complete.',
        priceNote: 'Price semantics follow the source API. No unit/line-total conversion is assumed.',
        purchases
      }, null, 2) : MarjaneExport.csv(purchases);
      const blob = new Blob([content], {type: message.format === 'json' ? 'application/json' : 'text/csv;charset=utf-8'});
      const url = URL.createObjectURL(blob);
      try {
        const id = await browser.downloads.download({url, saveAs: true,
          filename: 'marjane-history-' + now.slice(0, 10) + '.' + message.format});
        downloadUrls.set(id, url);
      } catch (_) {
        URL.revokeObjectURL(url);
        throw new Error('Download cancelled or failed.');
      }
      return status();
    }
    default: throw new Error('Unknown action.');
  }
});
