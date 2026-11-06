"""Bulk proxy text parser.

Accepts four line formats per the DESIGN_BRIEF_V2 bulk-paste surface:

    1. ``host:port:user:pass``
    2. ``host:port``
    3. ``scheme://user:pass@host:port``
    4. ``scheme://host:port``

Blank lines and lines beginning with ``#`` are ignored. Malformed lines are
reported through :func:`parse_bulk_text_detailed`; the thin wrapper
:func:`parse_bulk_text` yields only the successfully parsed dicts shaped like
:class:`backend.store.StoredProxyCreate`.

Scheme normalisation keeps us compatible with the strict ``ProxyType`` literal
in the store:

* ``http``, ``https`` → kept as-is.
* ``socks5``, ``socks5h`` → folded to ``socks5``.
* Anything else (incl. ``socks4``) → the line is rejected.

Shorthand (format 1 and 2) defaults the type to ``http``.
"""

from __future__ import annotations

from typing import Any, Iterator, Optional
from urllib.parse import unquote, urlparse

# ---------------------------------------------------------------------------
# constants
# ---------------------------------------------------------------------------

_HTTP_SCHEMES = {"http", "https"}
_SOCKS_ALIASES = {"socks5", "socks5h"}


# ---------------------------------------------------------------------------
# internals
# ---------------------------------------------------------------------------


def _normalize_type(raw: str) -> Optional[str]:
    """Fold a scheme / type token to one of ``http``, ``https``, ``socks5``.

    Returns ``None`` when the scheme is unsupported — the caller should skip
    the line so the operator sees a parse error instead of a silently
    mis-typed proxy.
    """
    scheme = raw.strip().lower()
    if scheme in _HTTP_SCHEMES:
        return scheme
    if scheme in _SOCKS_ALIASES:
        return "socks5"
    return None


def _valid_host(host: str) -> bool:
    """Loose host check — we leave the real validation to ``httpx``."""
    return bool(host) and " " not in host


def _valid_port(port: int) -> bool:
    return 1 <= port <= 65535


def _redact(line: str) -> str:
    """Strip credentials from a line so error responses never echo secrets.

    Handles both the ``scheme://user:pass@host:port`` and
    ``host:port:user:pass`` layouts. Everything else is returned unchanged
    because it contains no auth material anyway.
    """
    if "://" in line:
        try:
            parts = urlparse(line)
        except ValueError:
            return line
        if parts.username or parts.password:
            netloc = parts.hostname or ""
            if parts.port is not None:
                netloc = f"{netloc}:{parts.port}"
            return f"{parts.scheme}://***:***@{netloc}" if (parts.username or parts.password) else line
        return line

    pieces = line.split(":")
    if len(pieces) >= 4:
        return ":".join([pieces[0], pieces[1], "***", "***"])
    return line


def _parse_uri_form(line: str) -> Optional[dict[str, Any]]:
    """Parse ``scheme://[user[:pass]@]host:port``."""
    try:
        parts = urlparse(line)
    except ValueError:
        return None
    if not parts.hostname:
        return None
    if parts.port is None or not _valid_port(parts.port):
        return None
    proxy_type = _normalize_type(parts.scheme)
    if proxy_type is None:
        return None

    user = unquote(parts.username) if parts.username else None
    password = unquote(parts.password) if parts.password else None

    return {
        "name": f"{parts.hostname}:{parts.port}",
        "host": parts.hostname,
        "port": parts.port,
        "type": proxy_type,
        "user": user,
        "password": password,
    }


def _parse_colon_form(line: str) -> Optional[dict[str, Any]]:
    """Parse ``host:port`` or ``host:port:user:pass``.

    A password that itself contains colons is preserved by re-joining the
    trailing pieces — the AdsPower CSV dialect that this parser serves does
    allow punctuation in the secret.
    """
    pieces = line.split(":")
    if len(pieces) == 2:
        host, port_str = pieces
        user: Optional[str] = None
        password: Optional[str] = None
    elif len(pieces) >= 4:
        host, port_str = pieces[0], pieces[1]
        user = pieces[2]
        password = ":".join(pieces[3:])
    else:
        return None  # 1-piece or 3-piece is ambiguous — reject.

    if not _valid_host(host):
        return None
    try:
        port = int(port_str)
    except ValueError:
        return None
    if not _valid_port(port):
        return None

    return {
        "name": f"{host}:{port}",
        "host": host,
        "port": port,
        "type": "http",
        "user": user,
        "password": password,
    }


def _parse_one(line: str) -> Optional[dict[str, Any]]:
    """Dispatch a single stripped line to the right parser."""
    if "://" in line:
        return _parse_uri_form(line)
    return _parse_colon_form(line)


# ---------------------------------------------------------------------------
# public API
# ---------------------------------------------------------------------------


def parse_bulk_text_detailed(
    text: str,
) -> Iterator[tuple[int, Optional[dict[str, Any]], Optional[str]]]:
    """Yield ``(lineno, parsed_dict | None, error_message | None)`` per line.

    * Blank lines and ``#`` comments are skipped entirely (never yielded).
    * Parse successes yield ``(lineno, dict, None)``.
    * Parse failures yield ``(lineno, None, "reason")`` — the reason string
      has credentials redacted so it is safe to surface to the UI.
    """
    for lineno, raw in enumerate(text.splitlines(), start=1):
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        parsed = _parse_one(stripped)
        if parsed is None:
            yield (lineno, None, f"could not parse line: {_redact(stripped)}")
        else:
            yield (lineno, parsed, None)


def parse_bulk_text(text: str) -> Iterator[dict[str, Any]]:
    """Yield StoredProxyCreate-shaped dicts, one per successfully parsed line.

    Malformed lines are silently skipped — use
    :func:`parse_bulk_text_detailed` when you need per-line error reporting.
    """
    for _lineno, parsed, _err in parse_bulk_text_detailed(text):
        if parsed is not None:
            yield parsed
