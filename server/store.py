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
