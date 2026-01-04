# ES2 Import Tool

This is an Escape Simulator 2 tool for importing Room Builder assets from one room to another.

## What it does
- Scans your *Escape Simulator 2* UGC folder for rooms (folders containing `Room.room`).
- Lets you pick a **Source room** + **Target room**.
- Shows each room's prop tree.
- Lets you select a **source prop** (subtree root) and a **target parent prop**.
- Copies that subtree into the target room, including:
  - Fixing newly duplicated IDs
  - Fixing link arrays that reference props inside the copied subtree
  - Copying referenced assets (models, textures, sounds, scripts, material dependencies)
  - Creating a restore point (`Backups/Room.roomrstN` + optional `.assets.json` history log)
- Lets you restore the target room to a restore point, reverting copied assets using the asset history logs.

## Run (dev)
```bash
npm install
npm start
```

## Build installers
```bash
npm run dist
```
This uses `electron-builder` to produce installers for Windows / macOS / Linux (when built on those OSes).

## Notes
- `Room.room` is parsed with `json5` (tolerates trailing commas and comments).
- Output `Room.room` is written as standard JSON (pretty-printed).
- Restore points are stored per room in `<RoomFolder>/Backups/`.

