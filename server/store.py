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
            "re-enter the password in the Database panel, or delete secret.key and set the passwords again",
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
            "open the Database panel in DSH and add one, or import from DBeaver",
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
