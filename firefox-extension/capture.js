/* Fail-open stream observer: write every byte unchanged, close before parsing. */
(function (root) {
  'use strict';
  function observe(filter, {limit, complete, skipped, failed}) {
    let size = 0;
    let chunks = [];
    let finished = false;
    const disconnect = () => { try { filter.disconnect(); } catch (_) { /* Already closed. */ } };
    function stop() {
      if (finished) return;
      finished = true;
      chunks = [];
      disconnect();
    }
    filter.ondata = event => {
      if (finished) return;
      try {
        filter.write(event.data); // Never wait for JSON parsing, persistence or popup actions.
        size += event.data.byteLength;
        if (size > limit) {
          stop();
          skipped();
          return;
        }
        chunks.push(event.data.slice(0));
      } catch (_) {
        stop();
        failed();
      }
    };
    filter.onstop = () => {
      if (finished) return;
      finished = true;
      try { filter.close(); } catch (_) { disconnect(); }
      try {
        const decoder = new TextDecoder('utf-8', {fatal: true});
        let body = '';
        for (const chunk of chunks) body += decoder.decode(chunk, {stream: true});
        body += decoder.decode();
        chunks = [];
        complete(JSON.parse(body));
      } catch (_) {
        chunks = [];
        skipped(); // HTML errors/empty responses are not purchase records.
      }
    };
    filter.onerror = () => { if (!finished) { stop(); failed(); } };
    return stop;
  }
  root.MarjaneCapture = {observe};
  if (typeof module !== 'undefined') module.exports = {observe};
})(globalThis);
