const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness() {
  const listeners = {};
  const filters = [];
  const downloads = [];
  const event = name => ({addListener(fn) { listeners[name] = fn; }});
  const browser = {
    runtime: {id: 'test-extension', onMessage: event('message')},
    browserAction: {async setBadgeText() {}, async setBadgeBackgroundColor() {}},
    tabs: {async query() { return [{id: 4, url: 'https://www.marjane.ma/account/orders'}]; },
      onRemoved: event('removed'), onUpdated: event('updated')},
    downloads: {onChanged: event('downloadChanged'), async download(options) { downloads.push(options); return downloads.length; }},
    webRequest: {onHeadersReceived: event('headers'), filterResponseData() {
      const filter = {writes: [], write(data) { this.writes.push(data); },
        close() { this.closed = true; }, disconnect() { this.disconnected = true; }};
      filters.push(filter); return filter;
    }}
  };
  const context = vm.createContext({browser, URL, Blob, TextEncoder, TextDecoder});
  for (const filename of ['core.js', 'capture.js', 'background.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../firefox-extension', filename), 'utf8'), context);
  }
  const message = body => listeners.message(body, {id: browser.runtime.id});
  const request = overrides => ({tabId: 4, method: 'GET', statusCode: 200, requestId: 'test',
    url: 'https://api-ayaline.marjane.ma/customers/TEST_CUSTOMER/tickets', ...overrides});
  function response(data) {
    const filter = filters.at(-1);
    const bytes = new TextEncoder().encode(JSON.stringify(data));
    filter.ondata({data: bytes.buffer}); filter.onstop();
    return filter;
  }
  return {listeners, filters, downloads, message, request, response};
}

test('capture is off by default and limited to selected tab, GET, nonprivate success responses', async () => {
  const h = harness();
  h.listeners.headers(h.request());
  assert.equal(h.filters.length, 0);
  await h.message({action: 'start'});
  for (const overrides of [{tabId: 5}, {method: 'POST'}, {statusCode: 401}, {incognito: true},
    {url: 'https://api-ayaline.marjane.ma/coral/auth/confirm'}]) h.listeners.headers(h.request(overrides));
  assert.equal(h.filters.length, 0);
  h.listeners.headers(h.request());
  const filter = h.response([{ticket_key: 'TEST_TICKET', server: 7, ticket_total_price: 12}]);
  assert.equal(filter.closed, true);
  assert.equal((await h.message({action: 'status'})).purchases, 1);
});

test('pause disconnects in-flight responses, clear invalidates late callbacks', async () => {
  const h = harness();
  await h.message({action: 'start'});
  h.listeners.headers(h.request());
  await h.message({action: 'clear'});
  assert.equal(h.filters[0].disconnected, true);
  h.response([{ticket_key: 'LATE_TICKET', server: 7}]);
  assert.equal((await h.message({action: 'status'})).purchases, 0);
  assert.equal((await h.message({action: 'status'})).capturing, false);
});

test('JSON export has normalized purchases and no raw URL/customer/token fields', async () => {
  const h = harness();
  await h.message({action: 'start'});
  h.listeners.headers(h.request());
  const payload = [{ticket_key: 'TEST_TICKET', server: 7, ticket_total_price: 12,
    card_key: 'PRIVATE_CARD', token: 'PRIVATE_TOKEN'}];
  h.response(payload);
  h.listeners.headers(h.request({requestId: 'repeat'}));
  h.response(payload);
  assert.equal((await h.message({action: 'status'})).purchases, 1);
  await h.message({action: 'export', format: 'json'});
  const download = h.downloads[0];
  assert.equal(download.saveAs, true);
  const content = await (await fetch(download.url)).text();
  const result = JSON.parse(content);
  assert.equal(result.purchases.length, 1);
  assert.equal(result.purchases[0].total, 12);
  for (const value of ['PRIVATE_CARD', 'PRIVATE_TOKEN', 'TEST_CUSTOMER']) assert.ok(!content.includes(value));
  h.listeners.downloadChanged({id: 1, state: {current: 'complete'}});
});

test('tab close/offsite navigation pauses, and website messages cannot control capture', async () => {
  const h = harness();
  assert.equal(await h.listeners.message({action: 'start'}, {id: 'test-extension', tab: {id: 4}}), undefined);
  await h.message({action: 'start'});
  h.listeners.updated(4, {url: 'https://other.example/'});
  assert.equal((await h.message({action: 'status'})).capturing, false);
  await h.message({action: 'start'});
  h.listeners.removed(4);
  assert.equal((await h.message({action: 'status'})).capturing, false);
});
