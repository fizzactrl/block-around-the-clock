"""Single source of time. Timestamps are ISO-8601 UTC strings with millisecond
precision so they sort lexicographically and hash identically after a DB round-trip.
`frozen()` lets the seeder write a realistic back-dated history."""
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

_override: datetime | None = None


def now_dt() -> datetime:
    return _override or datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def now() -> str:
    return iso(now_dt())


def parse(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)


def plus(seconds: float, base: datetime | None = None) -> str:
    return iso((base or now_dt()) + timedelta(seconds=seconds))


@contextmanager
def frozen(dt: datetime):
    global _override
    previous = _override
    _override = dt
    try:
        yield
    finally:
        _override = previous
