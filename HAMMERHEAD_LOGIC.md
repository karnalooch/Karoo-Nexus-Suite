# Karoo 1 System Architecture & Injection Protocol

> [!IMPORTANT]
> This document contains distilled knowledge from reverse engineering Hammerhead Karoo 1 firmware and data synchronization services.

## 1. File System & Databases
The primary data store for ride profiles, bike settings, and user data is **Couchbase Lite 2.0+**.
- **Root Path**: `/data/data/io.hammerhead.datasyncservice/files/`
- **User Databases**: `database_<UID>.cblite2/db.sqlite3`
- **Common UIDs**: `184576`, `157072` (User-specific), `guest` (Guest profile).
- **Core Table**: `kv_default`
  - `key`: String identifier (e.g., `184576.ride_profile.indoor-power`)
  - `body`: **Fleece** encoded binary blob containing the profile configuration.

## 2. Profile Identification
Ride profiles are identified by the presence of the string `ride_profile` in the `body` blob.
The display name (e.g., "NEXUS-PRO") is typically found near the end of the blob, often preceded by a length byte or metadata tag.

## 3. Root Access (The Gateway)
Karoo 1 is vulnerable to the `mtk-su` exploit.
- **Binary Location**: `/data/local/tmp/mtk-su`
- **Usage**: Must be run with `-c` for single commands: `/data/local/tmp/mtk-su -c "command"`
- **Permissions**: Grants UID 0 (root) within the shell session.

## 4. Injection Workflow (The Surgery)
To modify a profile without the official Hammerhead Dashboard:
1. **Kill Service**: `adb shell am force-stop io.hammerhead.datasyncservice`
2. **Pull**: Copy `db.sqlite3` to `/sdcard/` via root, then `adb pull`.
3. **Patch**: 
   - Standard SQLite tools fail due to missing `fl_value()` functions used in indexes.
   - **Surgery**: Perform direct binary replacement of strings/values in the `.sqlite3` file, maintaining exact byte lengths (pad with spaces if shorter).
4. **Push**: `adb push` the patched file to `/sdcard/`.
5. **Inject**: 
   - Use `mtk-su` to copy the file back to the protected `/data/data/` path.
   - **CRITICAL**: Set permissions to `660` and ownership to `1000:1000`.
     ```bash
     chmod 660 db.sqlite3
     chown 1000:1000 db.sqlite3
     ```
6. **Restart**: `adb shell am start-foreground-service io.hammerhead.datasyncservice/.DataSyncService` (or `startservice` on older builds).

## 5. UI Components (Karoo Nexus Designer)
- **Profile Discovery**: Scans `database_*.cblite2` for `ride_profile` keys.
- **Field Mapping**: Identifies hex patterns for data fields (e.g., `4b4e585553...`).
- **Atmosphere Engine**: Handles UI transitions and state management for the desktop client.
