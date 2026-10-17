import importlib.util
from pathlib import Path
import unittest
import json

spec = importlib.util.spec_from_file_location(
    'proxy_history', Path(__file__).resolve().parents[1] / 'scripts/proxy_history.py'
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ProxyRedactionTests(unittest.TestCase):
    def test_scope(self):
        self.assertIsNone(module.target('https://other.example/coral/order'))
        self.assertIsNone(module.target('https://api-ayaline.marjane.ma/auth/authenticate'))

    def test_receipt_ids_and_query_values(self):
        result = module.target('https://api-ayaline.marjane.ma/customers/SECRET/tickets/9/PRIVATE'
                               '?page=2&token=PASSWORD&mode=Marjane')
        self.assertEqual(result['path'], '/customers/{customerId}/tickets/{serverId}/{ticketKey}')
        self.assertEqual([item['value'] for item in result['query']], ['2', '<redacted>', 'Marjane'])
        for private in ('SECRET', 'PRIVATE', 'PASSWORD'):
            self.assertNotIn(private, json.dumps(result))

    def test_response_values_are_not_persisted(self):
        result = module.shape({'ticket': {'card_key': 'SECRET'}, 'items': [{'price': 15.99}],
                               '123456': 'dynamic key', 'ok': True})
        self.assertEqual(result['ticket']['card_key'], 'string')
        self.assertEqual(result['items']['sample']['price'], 'number')
        self.assertEqual(result['ok'], 'boolean')
        self.assertNotIn('123456', result)
        self.assertNotIn('SECRET', json.dumps(result))


if __name__ == '__main__':
    unittest.main()
