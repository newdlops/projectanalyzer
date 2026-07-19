"""Functional-style receiver-chain fixture for Function Visualizer.

The entry functions cover constructor-owned fluent calls, argument evaluation,
variable receivers, chains inside conditions, and a subscript-selected callable
that must not be mistaken for a receiver chain.
"""


class FunctionalPipeline:
    """Small eager pipeline whose methods are valid drill-down targets."""

    def __init__(self, values):
        self.values = list(values)

    def filter(self, predicate):
        self.values = [value for value in self.values if predicate(value)]
        return self

    def map(self, mapper):
        self.values = [mapper(value) for value in self.values]
        return self

    def flat_map(self, mapper):
        self.values = [
            child
            for value in self.values
            for child in mapper(value)
        ]
        return self

    def tap(self, observer):
        for value in self.values:
            observer(value)
        return self

    def batch(self, size):
        self.values = [
            self.values[offset : offset + size]
            for offset in range(0, len(self.values), size)
        ]
        return self

    def reduce(self, reducer, initial):
        result = initial
        for value in self.values:
            result = reducer(result, value)
        return result

    def collect(self):
        return list(self.values)


class AlternatePipeline:
    """Duplicate method names ensure owner recovery cannot use name alone."""

    def __init__(self, values):
        self.values = values

    def filter(self, predicate):
        return self

    def map(self, mapper):
        return self

    def reduce(self, reducer, initial):
        return initial


def is_billable(record):
    """Predicate passed by identity into the functional chain."""

    return record.get("billable", False)


def normalize_record(record):
    """Mapper passed by identity into the functional chain."""

    return {
        "account_id": record["account_id"],
        "amount": int(record["amount"]),
    }


def expand_record(record):
    """Flat-map callback that emits one debit and one audit entry."""

    return [record, {**record, "audit": True}]


def merge_totals(totals, record):
    """Reducer accumulating a new result object at every step."""

    account_id = record["account_id"]
    return {
        **totals,
        account_id: totals.get(account_id, 0) + record["amount"],
    }


def run_functional_chain(records, audit):
    """Exercise a complete constructor-owned functional call chain."""

    return (
        FunctionalPipeline(records)
        .filter(is_billable)
        .map(normalize_record)
        .flat_map(expand_record)
        .tap(audit)
        .reduce(merge_totals, {})
    )


def collect_in_batches(records, batch_size):
    """Exercise a variable-rooted chain whose method names stay unique."""

    pipeline = FunctionalPipeline(records)
    return pipeline.batch(batch_size).collect()


def has_billable_records(records):
    """Keep a fluent chain inside a branch condition."""

    if FunctionalPipeline(records).filter(is_billable).collect():
        return True
    return False


def select_handler(handler_key):
    """Resolve a registry key without becoming a receiver-chain stage."""

    return handler_key.strip().lower()


def dispatch_chain_result(records, audit, handlers, handler_key):
    """Combine a valid fluent chain with a subscript-selected callable."""

    summary = run_functional_chain(records, audit)
    return handlers[select_handler(handler_key)](summary)
