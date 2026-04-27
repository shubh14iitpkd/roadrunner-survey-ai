"""Redis cache helpers.

Hot read-cache for read-heavy endpoints (notably /master/map-points). Keys
are namespaced by prefix; invalidation deletes by pattern. The cache is
optional — if `REDIS_URL` is unset or Redis is unreachable, every call
becomes a no-op (no exceptions propagate to handlers).

Pattern:
    body, status, headers = cache_get_response(key)
    if body is not None:
        return body, status, headers
    resp = compute()
    cache_set_response(key, resp, ttl=600)
    return resp
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from typing import Any

import redis
from flask import Flask, Response

log = logging.getLogger(__name__)

_client: redis.Redis | None = None


def init_cache(app: Flask) -> None:
    """Wire a Redis client onto the Flask app at startup.

    No-op if REDIS_URL is unset, or if the ping fails (graceful degrade —
    the app keeps running without caching).
    """
    global _client  # noqa: WPS420
    url = os.environ.get("REDIS_URL") or app.config.get("REDIS_URL")
    if not url:
        log.info("[CACHE] REDIS_URL unset — caching disabled")
        return
    try:
        client = redis.Redis.from_url(
            url,
            socket_timeout=0.5,
            socket_connect_timeout=0.5,
            health_check_interval=30,
        )
        client.ping()
        _client = client
        log.info("[CACHE] connected to %s", url)
    except Exception as e:  # noqa: BLE001
        log.warning("[CACHE] init failed (%s) — caching disabled", e)
        _client = None


def is_enabled() -> bool:
    return _client is not None


def make_key(prefix: str, **fields: Any) -> str:
    """Stable key from a dict of fields. Sorts keys so order doesn't matter."""
    payload = json.dumps(fields, sort_keys=True, default=str, separators=(",", ":"))
    digest = hashlib.sha1(payload.encode("utf-8")).hexdigest()[:16]
    return f"{prefix}:{digest}"


def cache_get_body(key: str) -> bytes | None:
    """Return cached response body bytes if key exists, else None.

    Body is stored RAW (no hex/JSON wrapper) — at multi-MB sizes the
    encoding/decoding overhead dominated the warm-hit latency.
    """
    if _client is None:
        return None
    try:
        return _client.get(key)
    except Exception as e:  # noqa: BLE001
        log.debug("[CACHE] get failed for %s: %s", key, e)
        return None


def cache_set_body(key: str, body: bytes, ttl: int) -> None:
    """Persist response body bytes under `key` for `ttl` seconds."""
    if _client is None:
        return
    try:
        _client.setex(key, ttl, body)
    except Exception as e:  # noqa: BLE001
        log.debug("[CACHE] set failed for %s: %s", key, e)


def invalidate_pattern(pattern: str) -> int:
    """Delete keys matching glob pattern (e.g. `assets:*`).

    Uses SCAN to avoid blocking on huge keyspaces. Returns count deleted.
    Safe no-op when caching disabled.
    """
    if _client is None:
        return 0
    deleted = 0
    try:
        for k in _client.scan_iter(match=pattern, count=500):
            _client.delete(k)
            deleted += 1
    except Exception as e:  # noqa: BLE001
        log.warning("[CACHE] invalidate %s failed: %s", pattern, e)
    return deleted


def invalidate_assets_cache() -> int:
    """Convenience wrapper: blow away every cached assets:* entry. Call from
    every master_assets write path so the next read re-computes."""
    return invalidate_pattern("assets:*")


def invalidate_roads_cache() -> int:
    """Wipe every cached roads:* entry. Call from every roads write path."""
    return invalidate_pattern("roads:*")
