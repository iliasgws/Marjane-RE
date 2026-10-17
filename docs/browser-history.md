# Signed-in website findings

The owner completed the official website's normal SMS login in T3's browser.
Subsequent inspection used ordinary read-only navigation, not phone access,
ADB, a system proxy or a native process attachment. Only response **field/type
structure**, status and redacted paths were returned to the research transcript.

## Routes

- Account page: `/account`.
- History: `/account/orders`, labelled “Historique de mes commandes”.
- Tabs: “En ligne” and “En magasin”.
- Website online-history API: `GET /front/customers/orders`, with
  `sort[created_at]`, `customer`, `range`, repeated `status[]`, and `refresh`.
  The observed response was HTTP 200 with an empty array. This is distinct from
  the newer mobile client's `/coral/order` flow; do not transfer one client's
  encoding assumptions to the other.
- In-store history: `GET /customers/{customerId}/tickets`, with `mode=Marjane`
  and `sort[created_at]=desc`. The observed successful list did not contain a
  `page` query parameter; mobile pagination is not proof of website pagination.
- Opening a ticket issued `GET
  /customers/{customerId}/tickets/{serverId}/{ticketKey}` and returned HTTP 200.

## Actual receipt structure (values omitted)

The observed list items contained:

```text
create: string
server: number
server_label: null (in the sampled item)
ticket_key: string
ticket_total_price: number
```

The observed ticket detail contained:

```text
ticket:
  card_key: string
  create: string
  ticket_key: string
ticket_total: number
ticket_total_discount: number
ticket_total_price: number
array_of_item[]:
  name_item: string
  price: number
  quantity: number
  hierarchy: {description: string, reference: string}
array_of_payment_mean[]:
  data_1: string
  data_2: string
```

Notably, the sampled detail's `ticket` had **no server ID**, so the exporter
retains the server ID from the request path to join it to the list record. The
card key is intentionally not retained by the exporter. Sampling one receipt
does not establish optional fields or all schemas used by other receipts.

## Firefox exporter verification

See [installation and limitations](../firefox-extension/README.md).
Normalization matches the receipt structures above; tests use synthetic values.
Firefox 155 successfully loaded the manifest as a temporary add-on in an isolated
headless profile. The 20-second smoke run was intentionally terminated after
installation. `web-ext lint` reports zero errors/warnings/notices, and 13
exporter-specific unit/integration-mock tests pass.

This is not a claim that a complete export was downloaded from a real signed-in
Firefox session: that end-to-end check remains for the owner after installation.

## Automatic ticket details (v0.2.0)

The website's “Détails du ticket” controls are buttons inside `article` receipt
cards. The full ticket number appears in a text node in that card. Clicking one
opens a `.modal`, sets `order_number` in the history URL, and exposes a close
button with `aria-label="Fermer"`. These structural properties were inspected
in the signed-in website without saving ticket values as fixtures.

The exporter uses those properties to open only already-captured in-store tickets
on the current page, wait for the corresponding normalized detail response, close
that ticket, then continue sequentially. The exact-ID/unique-control guards,
timeouts, cancellation and background integration have synthetic tests. A complete
automated run against a signed-in Firefox session remains an owner validation
step; no such end-to-end result is claimed by the tests.
