# Scoped live observation

> **Paused: native crash observed.** The hook loaded and captured two successful
> order-summary responses, but an instrumented session terminated with a native
> SIGSEGV. The user reports normal manual taps work. Frida is a suspected trigger,
> not a proven root cause. The temporary server was stopped; do not rerun the
> commands below on this device until the crash is understood and the owner
> agrees to another attempt. Offline tests do not establish runtime safety.

`scripts/observe_history.js` is a temporary Frida hook for the installed Marjane
app's OkHttp response path. It targets only `api-ayaline.marjane.ma` and:

- `/coral/order`
- `/customers/{customerId}/tickets`
- `/customers/{customerId}/tickets/{serverId}/{ticketKey}`

It emits HTTP status, header **names**, redacted URL templates, whitelisted
pagination/filter query values, and JSON field/type structure. It never emits
header values, token values, receipt scalar values, or IDs in paths. Arrays are
sampled at their first element. Structure depth, number of keys and body size
are capped. This is incomplete schema sampling, not a complete response export.

The observer uses `peekBody` for a bounded copy; it does not consume or replace
the app's response body. Copying can add latency. If instrumentation affects app
behavior, detach and compare with an uninstrumented run. Exception messages are
not logged because they may contain identifiers or URLs.

## Prerequisites

Root must be available to ADB. Frida client/server versions must match; the
tested setup uses Frida **17.24.1** and the **arm64** server. The server binary
is at `/data/local/tmp/marjane-re-frida` and listens only on `127.0.0.1:27042`.
No boot service, system proxy or certificate installation is used.

## First live findings (2026-10-17)

Two `GET /coral/order` requests returned HTTP 200 and JSON empty arrays:

```text
sort[created_at]=desc
status[]=STATUS_FINISHED
status[]=STATUS_VALIDATED
status[]=STATUS_PREPARING
status[]=STATUS_READY
status[]=STATUS_DELIVERING
status[]=STATUS_ERROR_PAYMENT
page=1
page_size=1
```

```text
sort[created_at]=desc
status[]=STATUS_DELIVERED
page=1
page_size=2
```

Both requests contained `accept-language`, `authorization`, `content-type` and
`user-id` header names. Values were not logged. Both responses had a
`content-range` header matching the digits-digits/digits pattern; counts were
redacted. These small-page requests are consistent with order summaries. They
do not verify the full history screen, a nonempty order schema, or receipt data.
No in-store receipt-list/detail requests were captured.

The failed attach by app identifier produced no observation. A subsequent PID
attachment loaded the hook but terminated. An app-scoped crash-buffer check for
that PID reported SIGSEGV/SEGV_MAPERR on the main thread. No backtrace or
controlled comparison has established whether this is a Frida/runtime issue or
app behavior. Do not describe it as a confirmed ADB-input crash: no ADB tap
commands were sent during this investigation.

## Previous capture procedure (paused; see crash warning)

Use the Frida CLI (which supplies its Java bridge), not bare Python
`create_script` without a Java bridge on Frida 17.

```sh
mkdir -p captures
chmod 700 captures
frida -U -f com.marjane.app -l scripts/observe_history.js -q -t 180 \
  --exit-on-error -o captures/history-frida.log
```

Wait for `event: ready`, then on your own signed-in account:

1. Open Mon compte → Historique de mes achats.
2. Open En magasin, pull to refresh, and open one receipt.
3. Return to En ligne, change one status filter and load another page if available.

Sign in manually if needed. Do not share login codes or tokens in chat. The hook
does not observe authentication endpoints. No purchases, redemptions or account
changes are necessary for this investigation.

Logs stay under ignored `captures/`, not in Git. Even structure-only logs should
be reviewed before publishing. A timeout detaches the hook; it leaves the app
running. Stop the temporary server separately after the investigation:

```sh
adb shell su -c 'kill $(pidof marjane-re-frida)'
```

The exact temporary binary can then be removed if no longer needed:

```sh
adb shell su -c 'rm /data/local/tmp/marjane-re-frida'
```

## Offline tests

```sh
node --test tests/observe_history.test.cjs
```

These test URL scope and redaction helpers only. Actual hook installation and
runtime observations must be verified separately; a successful unit test is not
evidence of a successful network capture.
