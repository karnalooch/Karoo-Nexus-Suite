#!/usr/bin/env python3
"""Fail closed when frontend Tauri invokes and registered Rust commands drift."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTEND_ROOT = ROOT / "src"
RUST_LIB = ROOT / "src-tauri" / "src" / "lib.rs"

# Legacy missing-command exceptions have been retired. Keep this explicit empty set:
# any new frontend invoke without a registered backend command must fail closed.
LEGACY_MISSING: set[str] = set()

# Registered commands without a frontend consumer are forbidden by default.
LEGACY_UNUSED_REGISTERED: set[str] = set()

INVOKE = re.compile(
    r"""\binvoke(?:\s*<[^>]+>)?\s*\(\s*["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]"""
)
HANDLER = re.compile(r"tauri::generate_handler!\s*\[(.*?)\]", re.DOTALL)
IDENT = re.compile(r"\b([A-Za-z_][A-Za-z0-9_]*)\b")


def frontend_invokes() -> dict[str, set[str]]:
    found: dict[str, set[str]] = {}
    for path in sorted(FRONTEND_ROOT.rglob("*")):
        if path.suffix not in {".ts", ".tsx", ".js", ".jsx"} or not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        rel = path.relative_to(ROOT).as_posix()
        for name in INVOKE.findall(text):
            found.setdefault(name, set()).add(rel)
    return found


def registered_commands() -> set[str]:
    text = RUST_LIB.read_text(encoding="utf-8")
    match = HANDLER.search(text)
    if not match:
        raise SystemExit("tauri contract: FAIL: generate_handler! block not found")

    commands = set(IDENT.findall(match.group(1)))
    if not commands:
        raise SystemExit("tauri contract: FAIL: generate_handler! block is empty")
    return commands


def main() -> int:
    invoked = frontend_invokes()
    invoked_names = set(invoked)
    registered = registered_commands()

    missing = invoked_names - registered
    unused_registered = registered - invoked_names

    unexpected_missing = missing - LEGACY_MISSING
    unexpected_unused = unused_registered - LEGACY_UNUSED_REGISTERED
    stale_missing_allowlist = LEGACY_MISSING - missing
    stale_unused_allowlist = LEGACY_UNUSED_REGISTERED - unused_registered

    if unexpected_missing:
        print("tauri contract: FAIL: frontend invokes unregistered commands:")
        for name in sorted(unexpected_missing):
            locations = ", ".join(sorted(invoked[name]))
            print(f"  - {name}: {locations}")

    if unexpected_unused:
        print("tauri contract: FAIL: registered commands without frontend consumers:")
        for name in sorted(unexpected_unused):
            print(f"  - {name}")

    if stale_missing_allowlist:
        print("tauri contract: FAIL: remove resolved commands from LEGACY_MISSING:")
        for name in sorted(stale_missing_allowlist):
            print(f"  - {name}")

    if stale_unused_allowlist:
        print(
            "tauri contract: FAIL: remove resolved commands from "
            "LEGACY_UNUSED_REGISTERED:"
        )
        for name in sorted(stale_unused_allowlist):
            print(f"  - {name}")

    if (
        unexpected_missing
        or unexpected_unused
        or stale_missing_allowlist
        or stale_unused_allowlist
    ):
        return 1

    print(
        "tauri contract: PASS: "
        f"{len(invoked_names)} frontend command(s), "
        f"{len(registered)} registered command(s)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
