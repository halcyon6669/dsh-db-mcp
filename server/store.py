"""Registry access for the db-mcp MCP server.

The plugin Host half owns the files; this module only reads them. Every tool call
re-reads the registry, so a source added or edited in the panel is visible to the
agent without restarting the server process.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import secretbox

SCHEMA_VERSION = 1
SETTINGS_FILE = "settings.json"

# path, the bytes last read, the parsed document
_settings_cache: tuple[Path, str, dict] | None = None


class StoreError(Exception):
    def __init__(self, code: str, message: str, hint: str | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.hint = hint


def runtime_dir() -> Path:
    override = os.environ.get("DB_MCP_RUNTIME")
    if override:
        return Path(override)
    home = os.environ.get("DSH_HOME")
    if not home:
        home = str(Path.home() / ".dsh")
    return Path(home) / "db-mcp"


def _read_json(path: Path, default):
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        return default
    except json.JSONDecodeError as error:
        raise StoreError("infra_error", f"{path.name} is not valid JSON: {error}")


def load_registry() -> dict:
    data = _read_json(runtime_dir() / "datasources.json", {"schemaVersion": SCHEMA_VERSION, "datasources": []})
    sources = data.get("datasources")
    if not isinstance(sources, list):
        raise StoreError("infra_error", "datasources.json has no datasources array")
    return data


def load_secrets() -> dict:
    data = _read_json(runtime_dir() / "secrets.json", {"secrets": {}})
    secrets = data.get("secrets")
    return secrets if isinstance(secrets, dict) else {}


def load_settings() -> dict:
    """Read settings.json, staying cheap enough to call on every tool call.

    The panel writes this file and the next call has to see the change, so the
    document is re-read rather than frozen at import. Only the *parse* is cached:
    the bytes are compared against the last read, which is a few hundred bytes
    and happens once per tool call — not once per cell, which is what made a
    timestamp cache look tempting. Comparing the text rather than the mtime also
    means a rewrite is noticed even when it lands in the same clock tick with the
    same length, which a timestamp comparison misses. A missing or malformed file
    reads as "no preference expressed", never as an error: a corrupt settings
    file must not take the database down with it.
    """
    global _settings_cache
    path = runtime_dir() / SETTINGS_FILE
    cached = _settings_cache
    try:
        raw = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        _settings_cache = (path, None, {})
        return {}
    if cached and cached[0] == path and cached[1] == raw:
        return cached[2]
    try:
        data = json.loads(raw)
    except ValueError:
        data = {}
    _settings_cache = (path, raw, data if isinstance(data, dict) else {})
    return _settings_cache[2]


def _source_key(profile: dict) -> str:
    """The file stem a datasource's graph, scenes and catalog share."""
    return str(profile.get("id") or "default")


def catalog_path(profile: dict, schema: str | None = None) -> Path:
    """Where one datasource's cached directory lives.

    The key is datasource **and** schema: the same table name in two schemas is
    two different tables, and a cache that mixed them could report a column type
    that belongs to the other one. A datasource with no schema keeps the plain
    ``<id>.json`` name, which is also where a cache written before schemas were
    part of the key already sits — so an upgrade never loses it.
    """
    stem = _source_key(profile)
    name = stem if not schema else f"{stem}__{schema}"
    return runtime_dir() / "catalog" / f"{name}.json"


def catalog_schema(profile: dict) -> str | None:
    """The schema this datasource is configured to read, if any."""
    config = profile.get("config")
    if not isinstance(config, dict):
        return None
    name = str(config.get("schema") or "").strip()
    return name or None


def catalog_schemas(profile: dict) -> list:
    """Every schema this datasource has a cache for, ``None`` last.

    A preview walks these in order, so a table known to one schema is still found
    when the configured schema has not been read yet.
    """
    folder = runtime_dir() / "catalog"
    stem = _source_key(profile)
    found: list = []
    try:
        names = sorted(entry.name for entry in folder.iterdir() if entry.suffix == ".json")
    except OSError:
        names = []
    for name in names:
        base = name[: -len(".json")]
        if base == stem:
            found.append(None)
        elif base.startswith(f"{stem}__"):
            found.append(base[len(stem) + 2 :] or None)
    # A named schema answers more questions than the schema-free file, so it is
    # tried first; `None` stays last as the fallback.
    named = [item for item in found if item]
    return named + ([None] if None in found else [])


def load_catalog(profile: dict, schema: str | None = None) -> dict | None:
    """Read a cached table/column catalog, or None when one was never saved.

    A preview consults this only — it must never open a database connection or
    look at table data. A missing or malformed file reads as "not checked", which
    is the honest answer when the reader has no local directory to compare with.

    With ``schema`` given, a schema-free cache is the fallback: it was written by
    an older build that did not know about schemas, and it is still the best
    local answer rather than "never checked".
    """
    data = _read_json(catalog_path(profile, schema), None)
    if not isinstance(data, dict) and schema:
        data = _read_json(catalog_path(profile), None)
    if not isinstance(data, dict):
        return None
    return data


def _stamp() -> str:
    from datetime import datetime, timezone

    moment = datetime.now(timezone.utc)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def save_catalog(profile: dict, catalog: dict, schema: str | None = None, read=()) -> dict:
    """Write a catalog snapshot, stamping what was actually read this time.

    Callers populate ``tables`` from list_tables/describe_table/discover_relations;
    this function owns the timestamps so a cache can never claim to be fresher
    than the moment it was written. ``read`` names the tables this call actually
    looked at (a table name, or ``(table, columns)``): only those get a fresh
    ``readAt``, so a narrow listing cannot make a table read last week look new.
    Reading a table also clears its "unread" mark.

    Returns the document actually written.
    """
    doc = dict(catalog)
    stamp = _stamp()
    doc["savedAt"] = stamp
    if schema:
        doc["schema"] = schema
    tables = doc.get("tables")
    if not isinstance(tables, dict):
        tables = {}
        doc["tables"] = tables
    touched = []
    for item in read or ():
        if isinstance(item, (tuple, list)):
            name = str(item[0]) if item else ""
            columns = item[1] if len(item) > 1 and isinstance(item[1], dict) else None
        else:
            name, columns = str(item), None
        if not name:
            continue
        entry = tables.get(name)
        if not isinstance(entry, dict):
            entry = {}
            tables[name] = entry
        if columns is not None:
            known = entry.get("columns")
            if not isinstance(known, dict):
                known = {}
                entry["columns"] = known
            for key, type_name in columns.items():
                # A union from foreign keys has no type; never let it erase a
                # type a describe_table call already recorded.
                if key not in known or known[key] is None or type_name is not None:
                    known[key] = type_name
        entry["readAt"] = stamp
        touched.append(name.casefold())
    unread = doc.get("unread")
    if isinstance(unread, list) and touched:
        doc["unread"] = [name for name in unread if str(name).casefold() not in touched]
    path = catalog_path(profile, schema)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(doc, handle, indent=2, ensure_ascii=False)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return doc


def table_stamp(catalog: dict | None, table: str) -> str | None:
    """When one table was last read, falling back to the file stamp.

    A cache written before per-table times existed only has ``savedAt``; treating
    it as every table's read time keeps that cache usable, and the whole-file
    comparison still downgrades it once it is old.
    """
    if not isinstance(catalog, dict):
        return None
    wanted = str(table or "").casefold()
    tables = catalog.get("tables")
    if isinstance(tables, dict):
        for name, entry in tables.items():
            if str(name).casefold() != wanted:
                continue
            if isinstance(entry, dict) and entry.get("readAt"):
                return str(entry["readAt"])
            break
    stamp = catalog.get("savedAt")
    return str(stamp) if stamp else None


def password_of(profile: dict, secrets: dict | None = None) -> str | None:
    secrets = secrets if secrets is not None else load_secrets()
    entry = secrets.get(profile.get("id"))
    if not isinstance(entry, dict):
        return None
    if not any(isinstance(entry.get(key), str) and entry.get(key) != "" for key in ("password", "#password")):
        return None
    try:
        return secretbox.open_password(entry, secretbox.load_key(runtime_dir()), profile.get("id"))
    except secretbox.SecretError as error:
        # Returning None here would turn an unreadable key into a misleading
        # authentication failure; say what is actually wrong instead.
        raise StoreError(
            "infra_error",
            str(error),
            "re-enter the password in the Data sources panel, or delete secret.key and set the passwords again",
        ) from error


def all_sources() -> list[dict]:
    return list(load_registry().get("datasources") or [])


def resolve(name: str | None) -> tuple[dict, dict]:
    """Resolve a datasource by id or name; fall back to the default source."""
    sources = all_sources()
    if not sources:
        raise StoreError(
            "user_error",
            "no datasource is configured yet",
            "open the Data sources panel in DSH and add one, or import from DBeaver",
        )
    if name:
        wanted = name.strip()
        for source in sources:
            if source.get("id") == wanted:
                return source, load_secrets()
        folded = wanted.casefold()
        for source in sources:
            if str(source.get("name") or "").casefold() == folded:
                return source, load_secrets()
        known = ", ".join(str(source.get("id")) for source in sources)
        raise StoreError("user_error", f"unknown datasource: {name}", f"known datasources: {known}")
    for source in sources:
        if source.get("isDefault"):
            return source, load_secrets()
    return sources[0], load_secrets()
