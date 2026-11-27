"""The tool-call audit log, written by the process that ran the call.

`logs/audit.jsonl` used to have exactly one writer: the Host half, whose wrapper
around each tool call knew the conversation the call came from. That wrapper only
ever sees calls it forwarded itself — the agent's stdio calls and the panel's
`/mcp/call` route. A client pointed straight at the HTTP endpoint (VS Code, Cursor,
Codex…) never touches the Host, so its calls left no line at all.

So the HTTP child writes its own lines now. It is the only process that can: it is
the one that ran the statement. The switch is `DB_MCP_AUDIT=1`, set by the Host when
it spawns the HTTP child and left unset for the stdio child, which keeps exactly one
writer per call — no call is ever recorded twice.

The shape matches the Host's entries field for field, because the panel parses both
with the same reader. `auditLog: false` in `settings.json` still silences it: the
file is re-read on every call, not cached at start-up, so flipping the switch in the
panel takes effect without restarting anything.

Each line also names the caller (`client`): the Host writes `dsh-agent` for the
agent's stdio calls and `panel` for its own `/mcp/call` route, while this process
reads the name the MCP handshake carried (`clientInfo.name` + version) — so a line
in the file answers "which program ran this statement", not just "some client did".
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import store

AUDIT_FILE = Path("logs") / "audit.jsonl"
AUDIT_LIMIT_BYTES = 512 * 1024
# A statement is the useful part of a line; the tail of a huge one is not.
MAX_SQL = 2000
# An approved scan is worth recording, but a line should stay a line.
MAX_CONFIRM = 20
TOOL_PREFIX = "mcp__db__"


def path() -> Path:
    """Where the log lives, resolved the same way the Host resolves it."""
    return store.runtime_dir() / AUDIT_FILE


def lines() -> list[dict]:
    """Every parsable line in the log, oldest rotation first.

    Reading is not gated by `enabled()`: that switch decides who *writes*, and a
    process that does not write can still want to read what another one wrote —
    mining joins out of past statements is exactly that case. A rotated file is
    included so a long-running install does not forget last week's joins, and a
    line that does not parse is skipped rather than failing the whole read: one
    truncated line from a killed process must not make the history unreadable.
    """
    base = path()
    found: list[dict] = []
    for target in (base.parent / "audit.1.jsonl", base):
        try:
            with target.open("r", encoding="utf-8") as handle:
                for raw in handle:
                    text = raw.strip()
                    if not text:
                        continue
                    try:
                        record = json.loads(text)
                    except ValueError:
                        continue
                    if isinstance(record, dict):
                        found.append(record)
        except OSError:
            continue
    return found


def _settings() -> dict:
    try:
        with (store.runtime_dir() / "settings.json").open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def enabled() -> bool:
    """True when this process is the one that should be recording.

    The environment decides who owns the file (the Host sets `DB_MCP_AUDIT=1` for
    the HTTP child only); `settings.json` decides whether the user wants lines at
    all. Both have to agree.
    """
    if os.environ.get("DB_MCP_AUDIT") != "1":
        return False
    return _settings().get("auditLog") is not False


def _stamp() -> str:
    """The Host writes `new Date().toISOString()`; match it to the millisecond."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _rows_of(outcome) -> int | None:
    """How many rows a call moved: written for a change, returned for a read."""
    if not isinstance(outcome, dict):
        return None
    affected = outcome.get("affectedRows")
    if isinstance(affected, int) and not isinstance(affected, bool):
        return affected
    count = outcome.get("rowCount")
    if isinstance(count, int) and not isinstance(count, bool):
        return count
    rows = outcome.get("rows")
    if isinstance(rows, list):
        return len(rows)
    return None


def client_name() -> str | None:
    """Who sent this call, as the MCP handshake named it — `name/version`.

    An MCP client announces itself once, in the `initialize` request
    (`clientInfo: {name, version}`); the SDK keeps it on the session, so every
    later `tools/call` on that session can read it back. VS Code, Cursor and the
    rest all send it, which is what makes "who ran this statement" answerable.

    Returns None when there is no request context (a direct call in a test, or
    the stdio child, where the Host records the line and knows the answer
    itself) and `"unnamed client"` when a client skipped the field.
    """
    try:
        from mcp.server.lowlevel.server import request_ctx

        context = request_ctx.get()
    except Exception:  # noqa: BLE001 - no SDK, or not inside a request
        return None
    session = getattr(context, "session", None)
    params = getattr(session, "client_params", None)
    info = getattr(params, "clientInfo", None)
    name = getattr(info, "name", None)
    if not isinstance(name, str) or not name.strip():
        return "unnamed client"
    version = getattr(info, "version", None)
    if isinstance(version, str) and version.strip():
        return f"{name.strip()} {version.strip()}"
    return name.strip()


def entry(name: str, args, started: float, outcome, error, now: float | None = None, client: str | None = None) -> dict:
    """Build one log line. Pure: no I/O, so the tests can check the shape."""
    call = args if isinstance(args, dict) else {}
    record = {
        "at": _stamp(),
        "tool": f"{TOOL_PREFIX}{name}",
        "datasource": call.get("datasource") if isinstance(call.get("datasource"), str) else None,
        "ok": error is None and not (isinstance(outcome, dict) and outcome.get("ok") is False),
        "ms": max(0, int(((time.time() if now is None else now) - started) * 1000)),
    }
    if isinstance(client, str) and client.strip():
        record["client"] = client.strip()
    sql = call.get("sql")
    if isinstance(sql, str):
        record["sql"] = sql[:MAX_SQL]
    table = call.get("table")
    if isinstance(table, str):
        record["table"] = table
    # Approving an expensive step is a decision worth a trace of its own: the log
    # names the joins that were allowed and how many, and nothing about what they
    # returned. A row sample never reaches this file.
    approved = call.get("confirm_slow")
    if isinstance(approved, (list, tuple)) and approved:
        ids = [str(item) for item in approved if item][:MAX_CONFIRM]
        record["confirm"] = ids
        record["confirmCount"] = len(ids)
    if error is not None:
        record["error"] = f"{type(error).__name__}: {error}"
        return record
    # A tool reports a failure as data (`{"ok": false, "error": {...}}`), not by
    # raising, so the code has to be lifted out of the payload.
    if isinstance(outcome, dict):
        failure = outcome.get("error")
        if isinstance(failure, dict) and failure.get("code"):
            record["code"] = failure["code"]
            if failure.get("message"):
                record["error"] = str(failure["message"])
        rows = _rows_of(outcome)
        if isinstance(rows, int):
            record["rows"] = rows
    return record


def record(name: str, args, started: float, outcome, error, client: str | None = None) -> None:
    """Append one line to the audit log. Never raises: a log must not break a call."""
    try:
        if not enabled():
            return
        if client is None:
            client = client_name()
        target = path()
        target.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(entry(name, args, started, outcome, error, client=client), ensure_ascii=False)
        with target.open("a", encoding="utf-8") as handle:
            handle.write(f"{line}\n")
        try:
            os.chmod(target, 0o600)
        except OSError:
            pass
        if target.stat().st_size > AUDIT_LIMIT_BYTES:
            target.replace(target.parent / "audit.1.jsonl")
    except Exception:  # noqa: BLE001 - auditing must never break a tool call
        return
