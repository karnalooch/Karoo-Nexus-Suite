#!/usr/bin/env python3
"""Fail closed when frontend Tauri invokes drift from registered Rust commands."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTEND_ROOT = ROOT / "src"
RUST_LIB = ROOT / "src-tauri" / "src" / "lib.rs"

# Existing Investigation controls that predate this contract. Keep this list shrinking:
# implementing or removing one of these commands must remove it from this allowlist.
LEGACY_MISSING = {
    "disarm_root_detection",
    "generate_ca_cert",
    "get_device_id",
    "inject_custom_map",
    "sideload_custom_ota",
    "start_map_proxy",
    "stop_map_proxy",
}

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
    registered = registered_commands()
    missing = set(invoked) - registered

    unexpected = missing - LEGACY_MISSING
    stale_allowlist = LEGACY_MISSING - missing

    if unexpected:
        print("tauri contract: FAIL: frontend invokes unregistered commands:")
        for name in sorted(unexpected):
            locations = ", ".join(sorted(invoked[name]))
            print(f"  - {name}: {locations}")

    if stale_allowlist:
        print("tauri contract: FAIL: remove resolved commands from LEGACY_MISSING:")
        for name in sorted(stale_allowlist):
            print(f"  - {name}")

    if unexpected or stale_allowlist:
        return 1

    print(
        "tauri contract: PASS: "
        f"{len(invoked)} frontend command(s), {len(registered)} registered command(s)"
    )
    if missing:
        print("tauri contract: known legacy gaps (must not grow):")
        for name in sorted(missing):
            locations = ", ".join(sorted(invoked[name]))
            print(f"  - {name}: {locations}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
