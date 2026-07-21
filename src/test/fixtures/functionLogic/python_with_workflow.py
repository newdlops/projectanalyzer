"""Python Function Logic fixture for synchronous and asynchronous context managers."""


def read_document(path):
    with open_resource(path) as resource, acquire_lock(path):
        payload = resource.read()
        validate_payload(payload)
    publish_payload(payload)
    return payload


async def sync_remote_document(client, key):
    async with client.session(key) as session:
        payload = await session.fetch()
        await session.persist(payload)
    await client.notify(payload)
    return payload
