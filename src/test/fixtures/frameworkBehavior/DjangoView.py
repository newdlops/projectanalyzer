"""Framework reading fixture: lazy queries, evaluation and response boundaries."""
from django.http import JsonResponse as JSON
from django.views.decorators.http import require_GET
from django.contrib.auth.decorators import login_required
from django.db import transaction as tx
from .models import Message as Mail


@login_required
@require_GET
def inbox(request):
    """Return the unread message count and mark matching messages as viewed."""
    pending = Mail.objects.filter(owner=request.user, viewed=False)
    count = pending.count()
    if count == 0:
        return JSON({"count": 0})
    with tx.atomic():
        pending.update(viewed=True)
        tx.on_commit(lambda: notify(request.user))
    return JSON({"count": count})
