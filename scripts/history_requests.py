#!/usr/bin/env python3
"""Offline reconstruction of purchase-history request targets from APK 4.0.7.

Prints a relative URL only. Never sends requests or handles credentials. Online
paths/queries are traced through the active Coral client; receipt paths through
the legacy requests client. Both remain pending authenticated wire verification.
"""

import argparse
from urllib.parse import quote

ONLINE_FILTERS = {
    "all": (),
    "pending": ("STATUS_OPEN_PENDING",),
    "finished": ("STATUS_FINISHED",),
    "validated": ("STATUS_VALIDATED",),
    "preparing": ("STATUS_PREPARING", "STATUS_ERROR_PAYMENT"),
    "ready": ("STATUS_READY",),
    "delivering": ("STATUS_DELIVERING",),
    "delivered": ("STATUS_DELIVERED",),
    "annulled": ("STATUS_CANCELLED",),
}


def online_statuses(filter_name="all"):
    if filter_name not in ONLINE_FILTERS:
        raise ValueError(f"Unknown filter: {filter_name}")
    if filter_name != "all":
        return ONLINE_FILTERS[filter_name]
    return tuple(status for name, statuses in ONLINE_FILTERS.items()
                 if name != "pending" for status in statuses)


def positive_page(page):
    if isinstance(page, bool) or not isinstance(page, int) or page < 1:
        raise ValueError("Page must be a positive integer")
    return page


def segment(value):
    # Deliberately stricter than the decompiled path interpolation: keep user
    # input inside one path segment. This is a research helper, not a JS emulator.
    text = str(value)
    if not text or text in (".", ".."):
        raise ValueError("An ID must be a nonempty path segment")
    return quote(text, safe="")


def online_target(page=1, filter_name="all"):
    # Url.stringifyQueryParams keeps bracketed keys literal, encoding values.
    statuses = online_statuses(filter_name)
    query = ["sort[created_at]=desc", f"page={positive_page(page)}"]
    query.extend(f"status[]={quote(status, safe='')}" for status in statuses)
    return "/coral/order?" + "&".join(query)


def receipt_list_target(customer_id, page=1):
    return (f"/customers/{segment(customer_id)}/tickets"
            f"?mode=Marjane&page={positive_page(page)}")


def receipt_detail_target(customer_id, server_id, ticket_key):
    return (f"/customers/{segment(customer_id)}/tickets/"
            f"{segment(server_id)}/{segment(ticket_key)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    online = sub.add_parser("online")
    online.add_argument("--page", type=int, default=1)
    online.add_argument("--filter", choices=ONLINE_FILTERS, default="all")
    receipts = sub.add_parser("receipts")
    receipts.add_argument("customer_id")
    receipts.add_argument("--page", type=int, default=1)
    detail = sub.add_parser("detail")
    detail.add_argument("customer_id")
    detail.add_argument("server_id")
    detail.add_argument("ticket_key")
    args = parser.parse_args()
    try:
        if args.command == "online":
            target = online_target(args.page, args.filter)
        elif args.command == "receipts":
            target = receipt_list_target(args.customer_id, args.page)
        else:
            target = receipt_detail_target(args.customer_id, args.server_id, args.ticket_key)
    except ValueError as error:
        parser.error(str(error))
    print(target)


if __name__ == "__main__":
    main()
