# Karoo 1 Couchbase Lite Database Architecture

This document outlines the reverse-engineered database architecture of the Hammerhead Karoo 1. The device uses Couchbase Lite 2 (CBLite) on top of SQLite to manage its internal state, synchronization, and user profiles.

## Database Location & Access
- **Path:** `/data/data/io.hammerhead.datasyncservice/files/*.cblite2/db.sqlite3`
- **Access Level:** Requires root (`uid=0`), typically achieved via `mtk-su`.
- **Service Owner:** `io.hammerhead.datasyncservice` (Handles cloud sync and local data brokering).

## Sharding Strategy
Hammerhead employs a sharded database approach to separate device-level state from user-specific data.

### 1. `database_device.cblite2`
**Purpose:** Global device configuration and system-level state.
- Hardware configuration and serial numbers.
- Firmware update metadata and OTA states.
- Global sensor pairing cache (ANT+/Bluetooth).
- Telemetry and bugsnag configurations.

### 2. `database_<USER_ID>.cblite2` (e.g., `database_184576.cblite2`)
**Purpose:** Primary user data container. The numerical ID corresponds to the Hammerhead Dashboard account ID.
- **Ride Profiles:** Custom screen layouts, data fields, and settings.
- **Workouts:** Synced structured workouts (TrainingPeaks, etc.).
- **Routes:** Downloaded navigation routes and waypoints.
- **Activities:** Local cache of recorded FIT/activity metadata before syncing.
- *Note:* Multiple user databases may exist (e.g., `157072` and `184576`) if multiple accounts logged in or if migrations occurred. The system uses the one matching the current active user profile.

### 3. `database_users.cblite2`
**Purpose:** Identity management and authentication.
- Maps internal device users to cloud `<USER_ID>` instances.
- Stores authentication tokens for the Hammerhead Cloud and 3rd party integrations (Strava, RideWithGPS, Komoot).

### 4. `database_guest.cblite2`
**Purpose:** Sandboxed data for "Guest Mode" rides.
- Contains default profiles that are reset when the guest session ends.

---

## Couchbase Lite Schema (SQLite Backing)

A `.cblite2` directory contains a `db.sqlite3` file which implements the Couchbase document store. Key tables include:

### `kv_default` (The Core Document Store)
This is the primary Key-Value store table where documents live.
- **`key` (TEXT):** The unique identifier of the document. Uses dot-notation for namespacing.
  - Examples: `184576.ride_profile.indoor-power`, `184576.route.b84a1...`
- **`body` (BLOB):** The actual JSON document, but encoded in **Couchbase Fleece** (a binary JSON format).
  - *Fleece Format:* Extremely fast, zero-allocation binary format.
  - *Forensics:* Strings within the blob are preceded by length/tag bytes (e.g., `0x40 | length`). For example, a 13-character string like `Basic Profile` will be preceded by `0x4D` (ASCII 'M'). This is why raw extraction yields `MBasic Profile` or `Knexus`.

### `kvmeta`
Stores metadata for the Key-Value store, including sequence numbers for synchronization.

### `kv_info` / `kv_checkpoints`
Used by the `DataSyncService` to maintain delta-sync states with the Hammerhead Cloud servers. These tables track which documents have been pushed/pulled.

---

## The "Surgery" Workflow (Database Injection)

Because the data is encoded in binary Fleece, direct SQL `UPDATE` statements using raw JSON strings **will corrupt the database or crash the sync service**.

**Safe Modification Strategy (Karoo Nexus Method):**
1. **Quiesce:** Force stop the sync service (`am force-stop io.hammerhead.datasyncservice`).
2. **Stage:** Copy the live `db.sqlite3` to an accessible location (e.g., `/sdcard/`).
3. **Pull & Patch:** Pull the DB to the PC. Perform a binary search-and-replace within the BLOB.
   - *Constraint:* The replacement string must be exactly the same length or padded with spaces, as changing the length breaks the Fleece offsets.
4. **Push & Inject:** Push the patched DB back to `/sdcard/`, then `cp` it over the live database.
5. **Restore Permissions:** `chmod 660` and `chown 1000:1000` (system).
6. **Restart:** Start the sync service (`am startservice io.hammerhead.datasyncservice/.DataSyncService`).

## Data Structure: Ride Profiles
Inside `kv_default`, keys ending in `.ride_profile.<slug>` dictate the UI of the Karoo while riding.
- They contain an array of `pages` (screens).
- Each page defines a layout type (e.g., 4-field, 6-field).
- Fields map to internal enum IDs like `TYPE_POWER_ID` or `TYPE_HEART_RATE_ID`.
- The display name is stored inside the blob, not derived from the SQLite key.
