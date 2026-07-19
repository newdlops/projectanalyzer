"""Python comprehension and receiver-call-chain visualization fixture.

The function intentionally combines eager one-line loops, nested filters,
dictionary emission, and chained calls at several structural depths.
"""


def build_visible_records(client, policy, serializer, publisher, group_ids, limit):
    """Build, index, and publish records through expression-level flow."""

    records = [
        record.normalize().enrich(policy.context()).freeze()
        for group in client.load_groups(group_ids).active().ordered()
        if policy.for_group(group).allows()
        for record in group.records().visible().limit(limit)
        if record.is_ready()
    ]
    encoded_by_key = {
        record.key(): serializer.for_record(record).encode()
        for record in records
        if record.should_index()
    }
    return publisher.begin(records, encoded_by_key).validate().persist().result()


def create_lazy_records(client, group_ids):
    """Keep a generator expression available as a lazy-flow limitation case."""

    return (
        record.normalize().freeze()
        for record in client.load(group_ids).visible().ordered()
    )


def add_rtcc_investors(rtcc, stakeholder_ids_to_add):
    """Pass a flat generator comprehension directly to a consuming call."""

    RtccInvestor.objects.bulk_create(
        RtccInvestor(
            right_to_consent_or_consult=rtcc,
            stakeholder_id=stakeholder_id,
        )
        for stakeholder_id in stakeholder_ids_to_add
    )
