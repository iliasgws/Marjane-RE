import importlib.util
from pathlib import Path
import unittest
from urllib.parse import parse_qs, urlsplit

spec = importlib.util.spec_from_file_location(
    "history_requests", Path(__file__).resolve().parents[1] / "scripts/history_requests.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RequestReconstructionTests(unittest.TestCase):
    def test_active_online_target(self):
        self.assertEqual(module.online_target(2, 'delivered'),
                         '/coral/order?sort[created_at]=desc&page=2&status[]=STATUS_DELIVERED')

    def test_all_excludes_pending(self):
        query = parse_qs(urlsplit(module.online_target()).query)
        self.assertNotIn('STATUS_OPEN_PENDING', query['status[]'])
        self.assertEqual(len(query['status[]']), 8)
        self.assertIn('STATUS_ERROR_PAYMENT', query['status[]'])
        self.assertEqual(query['page'], ['1'])

    def test_preparing_includes_payment_errors(self):
        self.assertEqual(module.online_statuses('preparing'),
                         ('STATUS_PREPARING', 'STATUS_ERROR_PAYMENT'))

    def test_receipt_paths(self):
        self.assertEqual(module.receipt_list_target('CUSTOMER', 3),
                         '/customers/CUSTOMER/tickets?mode=Marjane&page=3')
        self.assertEqual(module.receipt_detail_target('CUSTOMER', 9, 'TICKET'),
                         '/customers/CUSTOMER/tickets/9/TICKET')

    def test_ids_cannot_add_path_or_query(self):
        self.assertEqual(module.receipt_detail_target('A/B', 9, 'T?x=1'),
                         '/customers/A%2FB/tickets/9/T%3Fx%3D1')
        for value in ('', '.', '..'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                module.segment(value)

    def test_rejects_invalid_page_and_filter(self):
        for page in (0, -1, True, 1.5, '1'):
            with self.subTest(page=page), self.assertRaises(ValueError):
                module.online_target(page)
        with self.assertRaises(ValueError):
            module.online_target(filter_name='unknown')


if __name__ == '__main__':
    unittest.main()
