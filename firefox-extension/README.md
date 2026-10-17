# Marjane History Exporter for Firefox

Exports the purchase records you load on **marjane.ma**, using your existing
signed-in browser session. No phone, ADB, proxy, certificate installation or
separate API login. Independent research tool; not affiliated with Marjane.

## Install temporarily

Requires **desktop Firefox 142+**. This build is unsigned; regular permanent
installation requires Mozilla signing.

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on…**.
3. Select this directory's `manifest.json` (or the packaged ZIP).
4. Pin **Marjane History Exporter** to the toolbar if desired.

Temporary installation ends when Firefox closes. Reinstall and sign in normally
when needed. Do not copy session cookies or tokens into the extension.

## Export

1. In Firefox, sign in to `https://www.marjane.ma/` yourself.
2. Select that tab. Open the extension and click **Start new capture**.
3. Go to **Mon compte → Historique de mes commandes** (`/account/orders`).
   Refresh the page if you were already there.
4. Browse **En magasin** / **En ligne**, load additional pages, and open each
   **Détails du ticket** / order detail whose products you want to export.
5. Open the extension to see purchase, product-row and detail counts.
6. Click **Export JSON** or **Export CSV**, then choose a local file.
7. Click **Pause** when finished and **Clear captured data** when no longer needed.

**Only responses loaded after capture starts are included.** There is no automatic
pagination, background scraping, hidden API request, or guarantee that the file
contains your entire history. Opening receipt details is necessary for product
rows; list-only purchases export a summary row with empty product columns.
Online orders with embedded `content` can provide products without another page.

## Exported fields

- Purchase type, ticket/order ID or reference, source date string, store ID/name,
  status, total and total discount when present.
- Product name/code, quantity, API `price`, and explicit line total when supplied.
- Whether details have been loaded, and an endpoint **template**, never the raw
  URL containing a customer ID.

Fields are selected explicitly. Card numbers, customer IDs from URLs, phone
numbers, delivery/billing addresses, payment-card/payment-method data, cookies,
authentication headers and login tokens are not exported. Unknown fields are
omitted. JSON is the most faithful normalized export; raw API JSON is not saved.

CSV uses UTF-8 with a BOM, comma separators, quoted cells, and CRLF line endings.
Potential spreadsheet formulas in text are escaped with an apostrophe. Numbers
stay numeric. No currency, timezone, or unit-price-versus-line-price semantics are
inferred; dates and prices follow the source response. A missing value stays blank
or null instead of becoming zero.

Repeated list/detail responses are deduplicated by purchase type, store ID and
ticket/order ID. List reloads do not erase captured product details. Capturing a
new account in the same tab can mix records: **Clear / Start new capture before
switching accounts**.

## Privacy and permissions

- Capture is **off by default**, and limited to the selected Marjane tab.
- Only GET responses from explicit receipt/order routes on exact Marjane hosts
  are eligible; authentication, profiles, payment actions and other traffic are
  excluded. Private-window capture is not supported.
- Captured records live only in the background page's **memory**. There is no
  `storage` or `cookies` permission, telemetry, external service or upload.
  Clear/restart Firefox to discard records. Downloads remain on your disk.
- Firefox's `webRequest` / `webRequestBlocking` and site permissions are required
  to read eligible response streams. `activeTab` selects the capture tab;
  `downloads` provides the user-confirmed Save dialog.
- Every response byte is forwarded unchanged before parsing; processing never
  waits for popup actions or a file download. Oversize/error handling disconnects
  the observer. This is browser-local response observation, not a system proxy.

Limits: 2 MiB per response, 16 simultaneous observed responses, 2,000 purchases,
10 MiB of normalized data per session, and 2,000 products per purchase. Larger
responses are skipped; an overall record/data limit pauses capture. Export,
clear and capture a smaller range if necessary.

## Supported routes and verification

The signed-in website's receipt-list and detail **field structure** was checked
against real successful responses. Fixtures in tests are entirely synthetic.

```text
/customers/{customerId}/tickets
/customers/{customerId}/tickets/{serverId}/{ticketKey}
/front/customers/orders
/customers/services/documents/order[/{orderId}]
/coral/order[/{orderId}]
```

Only observed or APK-traced route families are supported. Future schema changes,
SSR-only records, different order-item structures, service-worker responses and
cache behavior may require updates. If counts stay zero, refresh after enabling
capture, check Firefox's site-access permission, and open a ticket detail. Never
interpret zero captured records as proof of no purchases.

## Development

No build dependencies are needed for the extension itself.

```sh
node --test tests/firefox-extension.test.cjs tests/firefox-background.test.cjs
npm exec --yes --package=web-ext -- web-ext lint --source-dir firefox-extension
python3 scripts/package_extension.py
```

Run those commands from the repository root. The package command creates
`dist/marjane-history-exporter-0.1.0.zip` using an explicit file allowlist, excluding
tests, private captures, local certificates and decompiled APK output.
