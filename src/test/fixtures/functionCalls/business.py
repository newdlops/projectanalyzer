"""Business diagram scope: builtin conditions, library aliases and local name collisions."""
import requests as http
from json import loads as decode
from json import loads as decode_payload
from billing.services import settle

def process_orders(orders):
    accepted = []
    http.get("https://example.invalid")
    decode("{}")
    decode_payload("{}")
    if len(orders) > 4:
        for order in orders:
            accepted.append(order.strip())
            if is_valid(order):
                persist(order)
                settle(order)
    return accepted

def is_valid(order):
    return bool(order.strip())

def persist(order):
    return order

def get(value):
    return value

def decode(value):
    return value

def append(value):
    return value

class Ledger:
    def save(self, order):
        return self.commit(order)

    def commit(self, order):
        return persist(order)

def custom_builtin_name(values):
    def len(items):
        return persist(items)
    return len(values)

def shadowed_parameter(values, persist):
    return persist(values)

def default_callback(values, callback=persist):
    return persist(values)

def local_import(value):
    from requests import get
    return get(value)

def local_project_import(value):
    from .billing.services import settle
    return settle(value)
