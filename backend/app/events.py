"""In-process pub/sub for Server-Sent Events, keyed by workspace."""
from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from typing import Any

_subscribers: dict[str, set[asyncio.Queue[str]]] = defaultdict(set)
_loop: asyncio.AbstractEventLoop | None = None


def bind_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _loop
    _loop = loop


def subscribe(workspace_id: str) -> asyncio.Queue[str]:
    queue: asyncio.Queue[str] = asyncio.Queue(maxsize=200)
    _subscribers[workspace_id].add(queue)
    return queue


def unsubscribe(workspace_id: str, queue: asyncio.Queue[str]) -> None:
    _subscribers[workspace_id].discard(queue)
    if not _subscribers[workspace_id]:
        _subscribers.pop(workspace_id, None)


def _deliver(workspace_id: str, message: str) -> None:
    for queue in list(_subscribers.get(workspace_id, ())):
        if queue.full():
            try:
                queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
        queue.put_nowait(message)


def publish(workspace_id: str, event: str, data: dict[str, Any]) -> None:
    """Safe to call from sync code running in a worker thread."""
    message = json.dumps({"event": event, "data": data}, default=str)
    if _loop is None or _loop.is_closed():
        return
    try:
        running = asyncio.get_running_loop()
    except RuntimeError:
        running = None
    if running is _loop:
        _deliver(workspace_id, message)
    else:
        _loop.call_soon_threadsafe(_deliver, workspace_id, message)
