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
      onRemoved: event('removed'), onUpdated: event('updated'), onActivated: event('activated')},
    downloads: {onChanged: event('downloadChanged'), async download(options) { downloads.push(options); return downloads.length; }},
    webRequest: {onHeadersReceived: event('headers'), filterResponseData() {
      const filter = {writes: [], write(data) { this.writes.push(data); },
        close() { this.closed = true; }, disconnect() { this.disconnected = true; }};
      filters.push(filter); return filter;
    }}
  };
  const context = vm.createContext({browser, URL, Blob, TextEncoder, TextDecoder, setTimeout});
  for (const filename of ['core.js', 'capture.js', 'automation.js', 'background.js']) {
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
  return {browser, listeners, filters, downloads, message, request, response};
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

test('automatic loading requires capture, captured receipts and the selected history tab', async () => {
  const h = harness();
  await assert.rejects(h.message({action: 'load-details'}), /Start capture/);
  await h.message({action: 'start'});
  await assert.rejects(h.message({action: 'load-details'}), /No pending tickets/);
  h.listeners.headers(h.request());
  h.response([{ticket_key: 'TEST_TICKET', server: 7}]);
  h.browser.tabs.query = async () => [{id: 5, url: 'https://www.marjane.ma/account/orders'}];
  await assert.rejects(h.message({action: 'load-details'}), /Select the Marjane tab/);
});

test('automation captures one detail, reports completion and leaves capture enabled', async () => {
  const h = harness();
  await h.message({action: 'start'});
  h.listeners.headers(h.request());
  h.response([{ticket_key: 'TEST_TICKET', server: 7}]);
  const actions = [];
  h.browser.tabs.executeScript = async () => {};
  h.browser.tabs.get = async () => ({id: 4, active: true});
  h.browser.tabs.sendMessage = async (id, message) => {
    actions.push(message.command);
    if (message.command === 'discover') return {ok: true, tickets: message.tickets};
    if (message.command === 'open') {
      h.listeners.headers(h.request({requestId: 'detail',
        url: 'https://api-ayaline.marjane.ma/customers/TEST_CUSTOMER/tickets/7/TEST_TICKET'}));
      h.response({ticket: {ticket_key: 'TEST_TICKET'}, array_of_item: [{name_item: 'Synthetic', price: 2, quantity: 1}]});
    }
    return {ok: true, clicked: true, closed: true};
  };
  await h.message({action: 'load-details'});
  await new Promise(resolve => setTimeout(resolve, 1000));
  const state = await h.message({action: 'status'});
  assert.deepEqual(actions, ['discover', 'open', 'close', 'closed']);
  assert.equal(state.automation.completed, 1);
  assert.equal(state.automation.running, false);
  assert.equal(state.capturing, true);
  assert.equal(state.items, 1);
});

test('stopping during discovery prevents clicks and preserves captured records', async () => {
  const h = harness();
  await h.message({action: 'start'});
  h.listeners.headers(h.request());
  h.response([{ticket_key: 'TEST_TICKET', server: 7}]);
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const actions = [];
  h.browser.tabs.executeScript = async () => {};
  h.browser.tabs.sendMessage = async (id, message) => {
    actions.push(message.command);
    await pending;
    return {ok: true, tickets: message.tickets};
  };
  const start = h.message({action: 'load-details'});
  await new Promise(resolve => setImmediate(resolve));
  await h.message({action: 'stop-details'});
  release();
  await start;
  assert.deepEqual(actions, ['discover']);
  const state = await h.message({action: 'status'});
  assert.equal(state.automation.running, false);
  assert.equal(state.purchases, 1);
});

test('waits for close control readiness, clicks once, then checks disappearance', async () => {
  const h = harness();
  await h.message({action: 'start'});
  h.listeners.headers(h.request());
  h.response([{ticket_key: 'TEST_TICKET', server: 7}]);
  let readinessChecks = 0;
  let closeClicks = 0;
  let disappearanceChecks = 0;
  h.browser.tabs.executeScript = async () => {};
  h.browser.tabs.get = async () => ({active: true});
  h.browser.tabs.sendMessage = async (id, message) => {
    if (message.command === 'discover') return {ok: true, tickets: message.tickets};
    if (message.command === 'open') {
      h.listeners.headers(h.request({requestId: 'detail',
        url: 'https://api-ayaline.marjane.ma/customers/TEST_CUSTOMER/tickets/7/TEST_TICKET'}));
      h.response({ticket: {ticket_key: 'TEST_TICKET'}, array_of_item: []});
    }
    if (message.command === 'close') {
      const clicked = ++readinessChecks === 3;
      if (clicked) closeClicks++;
      return {ok: true, clicked};
    }
    if (message.command === 'closed') return {ok: true, closed: ++disappearanceChecks >= 3};
    return {ok: true};
  };
  await h.message({action: 'load-details'});
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert.equal((await h.message({action: 'status'})).automation.completed, 1);
  assert.equal(readinessChecks, 3);
  assert.equal(closeClicks, 1);
  assert.equal(disappearanceChecks, 3);
});
