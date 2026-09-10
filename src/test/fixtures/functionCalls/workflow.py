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

def nested_calls():
    return notify(persist(audit(1)) if is_ready(1) else reject("invalid"))

def repeat_decision(enabled):
    if enabled:
        persist(1)
    audit(2)
    if enabled:
        notify(3)
    return finish()

def loop_control(items):
    for item in items:
        if not is_ready(item):
            continue
        persist(item)
        if item > 10:
            break
        notify(item)
    return finish()

def load_items():
    return [1, 2]

def iterator_calls():
    for item in load_items():
        persist(item)
    return finish()

def condition_loop():
    item = 1
    while is_ready(item):
        persist(item)
        item += 1
    return finish()

def cleanup(enabled):
    try:
        if enabled:
            return persist(1)
        return reject("invalid")
    finally:
        audit(2)

def nested_cleanup():
    try:
        try:
            return persist(1)
        finally:
            audit(2)
    finally:
        notify(3)

def override_cleanup():
    try:
        return persist(1)
    finally:
        return notify(2)

def throw_cleanup():
    try:
        raise reject("invalid")
    finally:
        audit(2)

def caught_throw():
    try:
        raise reject("invalid")
    except Exception:
        audit(1)
    finish()

def loop_cleanup(items):
    for item in items:
        try:
            if not is_ready(item):
                continue
            persist(item)
            break
        finally:
            audit(item)
    return finish()
