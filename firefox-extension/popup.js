'use strict';
/* global browser */
const byId = id => document.getElementById(id);
let busy = false;
function render(state) {
  for (const key of ['purchases', 'items', 'detailed']) byId(key).textContent = String(state[key]);
  byId('status').textContent = (state.capturing ? '● Recording. ' : '') + state.notice;
  byId('pause').disabled = !state.capturing || busy;
  byId('start').disabled = busy || state.capturing;
  byId('clear').disabled = busy;
  for (const id of ['json', 'csv']) byId(id).disabled = busy || state.purchases === 0;
  byId('diagnostics').textContent = `${state.responses} responses · ${state.skipped} empty/unsupported/oversize · ${state.errors} observation errors`;
}
async function action(message) {
  if (busy) return;
  busy = true;
  for (const button of document.querySelectorAll('button')) button.disabled = true;
  try { render(await browser.runtime.sendMessage(message)); }
  catch (error) { byId('status').textContent = error.message || 'Operation failed.'; }
  finally {
    busy = false;
    // Do not replace an action's error message with the status refresh.
    const message = byId('status').textContent;
    try { render(await browser.runtime.sendMessage({action: 'status'})); } catch (_) { /* Keep the error. */ }
    byId('status').textContent = message;
  }
}
for (const id of ['start', 'pause', 'clear']) byId(id).addEventListener('click', () => action({action: id}));
for (const format of ['json', 'csv']) byId(format).addEventListener('click', () => action({action: 'export', format}));
browser.runtime.sendMessage({action: 'status'}).then(render).catch(() => {
  byId('status').textContent = 'Could not contact the extension. Reload it in about:debugging.';
});
setInterval(() => {
  if (!busy) browser.runtime.sendMessage({action: 'status'}).then(render).catch(() => {});
}, 1000);
