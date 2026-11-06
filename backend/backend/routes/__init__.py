"""HTTP + SSE routers mounted under `/api` by `backend.main`.

Keep each module focused: one resource per file (proxies, profiles, runs,
stream, meta). Shared helpers live in `backend.bridge` and `backend.store`.
"""
