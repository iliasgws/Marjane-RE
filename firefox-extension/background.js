'use strict';
/* global browser, MarjaneExport, MarjaneCapture */
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

function pause(message) {
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
  notice = 'Captured loaded history. Open receipt details to include products.';
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
    if (url.protocol !== 'https:' || !['www.marjane.ma', 'marjane.ma'].includes(url.hostname)) {
      pause('Capture paused after leaving Marjane.');
    }
  } catch (_) { pause('Capture paused.'); }
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
