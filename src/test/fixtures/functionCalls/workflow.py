"""Call-mode fixture with early return, a loop, guarded calls and a shared target."""
def process_batch(items, enabled):
    if not enabled:
        return reject("disabled")
    for item in items:
        if is_ready(item):
            persist(item)
            notify(item)
        else:
            reject("invalid")
    if len(items) > 4:
        audit(len(items))
    finish()
    return persist(len(items))

def is_ready(item):
    return item > 0

def persist(item):
    return audit(item)

def notify(item):
    return audit(item)

def reject(reason):
    return reason

def audit(value):
    return value

def finish():
    external_transport.send()

def countdown(value):
    return countdown(value - 1) if value > 0 else 0

def short_circuit(enabled):
    return enabled and is_ready(1)

def final_branch_loop(items):
    for item in items:
        if is_ready(item):
            notify(item)
