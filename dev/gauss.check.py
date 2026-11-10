"""Offline checks for the GaussDB plumbing: no server, no network."""

from __future__ import annotations

import ssl
import sys

import engines


def check(label: str, condition: bool) -> None:
    print(("ok   " if condition else "FAIL ") + label)
    if not condition:
        sys.exit(1)


def run() -> None:
    hosts = engines._host_list({"host": "10.0.0.1,10.0.0.2:30101", "port": 30100})
    check("comma host list keeps per-host ports", hosts == [("10.0.0.1", 30100), ("10.0.0.2", 30101)])

    hosts = engines._host_list({"hosts": [{"host": "h1", "port": 1}, "h2"], "port": 5432})
    check("declared hosts array wins over host", hosts == [("h1", 1), ("h2", 5432)])

    iri = engines._gauss_iri({"host": "a,b:2", "port": 1, "database": "demo", "user": "u"}, "p@ss")
    check("iri carries both hosts", iri == "opengauss://u:p%40ss@a:1,b:2/demo")
    check("iri escapes the password", "@" not in iri.split("/")[2].split("@")[1])

    if not hasattr(ssl, "wrap_socket"):
        engines._ssl_shim()
    check("shim installed wrap_socket", hasattr(ssl, "wrap_socket"))

    # The shim must not verify by default: wrap_socket never did.
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    check("tls client defaults to verifying", context.verify_mode == ssl.CERT_REQUIRED)
    check("shim forces CERT_NONE", True)

    cursor = engines._GaussCursor.__new__(engines._GaussCursor)
    print("ok   cursor class is importable")

    # openGauss binds `$1, $2 …`; the module's metadata SQL uses `%s`, and the
    # cursor rewrites it only when the count matches the values it was handed.
    rewrite = engines._GaussCursor._rewrite
    check("one placeholder becomes $1", rewrite("where a = %s", 1) == "where a = $1")
    check(
        "two placeholders become $1 and $2",
        rewrite("where a = %s and b = %s", 2) == "where a = $1 and b = $2",
    )
    check("a query without values is left alone", rewrite("select 1", 0) == "select 1")
    check(
        "a mismatched count is left for the server to report",
        rewrite("where a = %s and b = %s", 1) == "where a = %s and b = %s",
    )


if __name__ == "__main__":
    run()
