"""Plain-HTTP SpacetimeDB client (there is no maintained Python SDK for 2.x)."""
import json
import time

import requests

TIMESTAMP_FIELD = "__timestamp_micros_since_unix_epoch__"


class StdbError(RuntimeError):
    pass


def opt(value) -> dict:
    """SATS-JSON encoding for option<T> in reducer args."""
    return {"none": []} if value is None else {"some": value}


def sql_str(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def decode(value, ty: dict):
    """Decode one SQL-result cell using its algebraic type."""
    if "Sum" in ty:
        variants = ty["Sum"]["variants"]
        if [v["name"].get("some") for v in variants] == ["some", "none"]:
            tag, inner = value
            return decode(inner, variants[0]["algebraic_type"]) if tag == 0 else None
        return value
    if "Product" in ty:
        elements = ty["Product"]["elements"]
        names = [e["name"].get("some") for e in elements]
        if names == [TIMESTAMP_FIELD]:
            return value[0]
        return {n: decode(v, e["algebraic_type"]) for n, v, e in zip(names, value, elements)}
    if "Array" in ty:
        if isinstance(value, str) and "U8" in ty["Array"]:  # array<u8> comes back hex-encoded
            return list(bytes.fromhex(value))
        return [decode(v, ty["Array"]) for v in value]
    return value


class StdbClient:
    def __init__(self, base_url: str, database: str, token: str | None = None, session=None):
        self._base = f"{base_url.rstrip('/')}/v1/database/{database}"
        self._session = session or requests.Session()
        self._headers = {"Content-Type": "application/json"}
        if token:
            self._headers["Authorization"] = f"Bearer {token}"

    def _post(self, path: str, data: bytes | str):
        try:
            return self._session.post(f"{self._base}/{path}", data=data, headers=self._headers, timeout=60)
        except requests.RequestException as exc:
            raise StdbError(f"{path} -> network error: {exc}") from exc

    def sql(self, query: str) -> list[dict]:
        r = self._post("sql", query.encode())
        if r.status_code != 200:
            raise StdbError(f"sql -> HTTP {r.status_code}: {r.text[:200]}")
        rows = []
        for statement in r.json():
            elements = statement["schema"]["elements"]
            names = [e["name"]["some"] for e in elements]
            for row in statement["rows"]:
                rows.append({n: decode(v, e["algebraic_type"]) for n, v, e in zip(names, row, elements)})
        return rows

    def call(self, reducer: str, *args) -> None:
        for attempt in range(4):
            r = self._post(f"call/{reducer}", json.dumps(list(args)))
            if r.status_code == 200:
                return
            if r.status_code < 500 or r.status_code == 530:  # 530 = the reducer threw
                raise StdbError(f"{reducer} -> HTTP {r.status_code}: {r.text[:200]}")
            time.sleep(2 ** attempt)
        raise StdbError(f"{reducer}: gave up after retries")
