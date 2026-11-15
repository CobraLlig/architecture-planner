# Plan — Architectural Planner

A browser-based planning tool that starts as simple, fast floor-plan drafting and is built to grow
into full building design (electrical, plumbing, structural, construction documents, renders).

## Run it

Double-click `start.bat` (or run `node serve.mjs`) and open http://localhost:5173.
No install or build step; three.js is vendored in `vendor/`. Your work autosaves in the browser;
use **Save / Open** for `.archplan.json` files.

## What works now (Phase 1 — Layout)

- Walls with mitred joins, auto-splitting at T-junctions and crossings; type exact lengths while drawing (`12'6`, `3.5m`)
- Doors (single, double, sliding, open) and windows that snap into walls and cut them; swing follows the cursor
- Rooms detected from closed wall loops, with live area and floor type
- 30-item furniture and fixture library that snaps flush to walls; rotate, resize, duplicate
- Dimensions, notes, multiple levels (with the level below shown as an underlay)
- 3D view (orbit, sun, roof, hide levels above, capture PNG) and Split view
- Print sheets: vector SVG at true scale (1/4" = 1'-0", 1:50, …) with border, title block, north arrow, scale bar; Print / Save as PDF
- Undo/redo, copy/paste, ft-in or metric

## On phones and tablets (installable, works offline)

- **Touch:** tap to select or place, drag to move, one finger on empty space pans, two fingers pan and pinch-zoom, ▢ box-selects. With a tool active, drag to position the preview and lift to place. A bar at the bottom offers Undo, Redo, Rotate, Flip swing, Duplicate, Delete, Type length and Done. Furniture and Properties open as drawers.
- **Install:** Android/desktop Chrome and Edge show an **Install** button; on iPhone/iPad use Share → Add to Home Screen. Installed copies open from the home screen and work with no connection (everything, including 3D and PDF import, is cached).
- **Updating:** run `node build.mjs` before every deploy. It redraws icons if missing, stamps a build id, and writes the offline file list into `sw.js` so installed copies refresh themselves ("A new version is ready — tap to reload").
- While developing locally the service worker is off unless the address has `?sw`, so you never see stale files.

## Importing plans, scans and dimensions

Use **Import…** (or drag a file onto the window).

| File | What you get |
|---|---|
| **DXF** (CAD, MagicPlan, Floorplanner, most plan software) | Pick wall layers and units; double-line wall outlines become centre-line walls with the right thickness, corners are closed, doorway gaps become door openings, rooms are created, DXF dimensions and text come across. All linework is also kept as a snappable tracing guide. |
| **SVG** | Same as DXF (choose units). |
| **PDF / JPG / PNG** | Placed as a tracing underlay. Pick the PDF's print scale, or click two points of a known distance to calibrate. "Level it" squares a crooked scan. |
| **RoomPlan JSON** (iPhone/iPad LiDAR apps) | Walls, doors, windows and recognised furniture arrive as editable objects with real measured sizes. |
| **PLY / OBJ / XYZ / PTS** (point clouds, meshes) | A horizontal slice (above the floor, below the ceiling) becomes a to-scale underlay, and straight walls are traced automatically at any scan orientation. |

References live in the **References** panel (opacity, lock, hide, set scale). They never print.
Not read directly yet: DWG (export DXF, or use the free ODA File Converter), IFC, USDZ, E57/LAS.

## Architecture (why it can grow into BIM)

Everything is a typed entity in one flat map (`js/store.js`) with `type`, `level`, `discipline` and properties
(wall, opening, room, furniture, dim, text). Openings are hosted on walls by id, rooms are derived from the wall graph,
so editing a wall updates everything attached. The 2D renderer (`js/render2d.js`) draws to either a canvas or an
SVG recorder (`js/svgctx.js`), so screen and print share one code path.

| Add this… | …by doing this |
|---|---|
| Electrical / plumbing symbols | new entity types + library entries with `discipline: 'elec' / 'plmb'`; the Layers panel and tabs are already stubbed |
| Structural members | `column`, `beam`, `footing` entities; `wall.structural` flag already exists |
| Elevations / sections | new views that project the same entities (3D model already built from them in `js/view3d.js`) |
| Schedules | queries over `store.list('opening')` etc. |

## Roadmap

1. **Layout** (done) — drafting, furnishing, 3D, printable plans
2. **Building systems** — outlets/switches/lights/panel + circuits; fixtures + supply/drain routing; schedules; per-discipline sheets
3. **Structure & recommendations** — footings, columns, beams, joist/truss layout; load-bearing checks; egress/stair/ceiling code prompts; roof designer
4. **Construction documents & renders** — elevations, sections, details and callouts, multi-sheet sets; materials/lighting and exterior renders; IFC/DXF import–export

> Not for construction. Structural and code features, when added, are planning aids and must be verified by a licensed professional.
