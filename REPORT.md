# REPORT — Maze Chase Level Editor

## 1. Technical decisions

### Data structures

The board is a `LevelGrid` holding two flat `Uint8Array` buffers — one for cell kinds (wall, pellet, etc.) and one for spawn directions. This keeps memory compact for large grids (a 1000x1000 board is ~2 MB) and allows zero-copy transfer to the Web Worker via `postMessage` with transferables.

Undo/redo uses an array of `CellChange[]` gestures. Each gesture records every cell modified during a single pointer drag, storing before/after values for both kind and direction. This makes undo O(k) where k is the number of cells in one stroke, rather than snapshotting the full grid.

### Rendering architecture

Performance on large boards required a layered approach, each layer addressing a different bottleneck:

1. **requestAnimationFrame coalescing** — a `drawScheduled` flag ensures at most one render per frame, no matter how many state changes occur.
2. **Dirty-region tracking** — a `dirtyCells` Set records which cells changed. The renderer only repaints those cells unless a full redraw is needed (resize, pan).
3. **Overlay canvas** — the cursor highlight is drawn on a separate canvas with `pointer-events: none`. Mouse movement never triggers cell repaints on the main canvas.
4. **Virtual panning** — instead of placing the canvas inside a large scrollable div (which causes browser compositor issues beyond ~8000px), the viewport uses `overflow: hidden` and tracks `panX`/`panY` offsets via wheel events. Only visible cells are drawn. This is the same approach used by infinite-canvas tools like Figma.

### Sync design

The editor treats the backend as the authority:

- Every level has an `id` and `version`. Saves pass `base_version` to the backend, which returns 409 on conflict.
- On conflict, the editor loads the server's version and compares it to the local snapshot. If they match, the save is silently accepted. If they differ, the user sees a "conflict" state and can reload.
- Auto-save fires 350ms after each edit (debounced). A `revision`/`acknowledgedRevision` counter prevents redundant saves.
- A `beforeunload` guard prevents closing the tab with unsaved work.
- Encoding/decoding the ascii2d format runs in a Web Worker to keep the main thread free during save.

### UI design

The editor uses a ribbon-style toolbar inspired by CAD softwares like AutoCAD and Microsoft Visio. All actions, tile tools, and zoom controls live in a single horizontal bar with labeled groups, keeping vertical space for the canvas. Destructive actions (Clear All) require a confirmation modal. A help modal documents all interactions.

Spawn direction uses a drag-to-direct interaction: clicking places a Player/Ghost facing right; dragging from that cell sets the facing direction based on the drag vector. For existing spawns, a Select tool plus Rotate button allows precise adjustment. This avoids cluttering the toolbar with directional arrows.

Right-click erase was added by AI and later was removed since accidental right-clicks could silently erase work, and the Erase tool provides explicit, intentional control.

## 2. What I read and what I chose not to change

### What I read

Before writing any editor code, I ran the game and played it multiple times to understand the mechanics and the feel of a finished level. I then brainstormed editor ideas independently, including toolbar layout, actions, and generation strategies before reading the codebase.

I studied the game engine (cell types, direction enum), the rendering module (reused its drawing functions directly in the editor), the game's visual style (adopted the same color palette), and the backend API and its version-based locking (which shaped the sync design).

Before I deep dive into the game codebase, I had the idea of implementing some random board generation mechanisms, where later I discovered that it already exists with some placement rules for ghosts and power pellets.

### What I chose not to change

- **Backend code** — I considered adding a delete-level endpoint but decided to keep the backend untouched and focus entirely on editor features. The existing API surface (list, load, generate, store) covers the editor's needs.
- **Game engine** — no changes to mechanics, as specified.
- **Rendering functions** — `drawPlayer`, `drawGhost`, etc. are imported as-is. The editor adds a small black chevron overlay on ghosts to indicate direction (since unlike the player's mouth, ghosts have no directional visual), but the base rendering is unchanged.
- **Board visual style** — my instinct was that walls should be lighter (shaded) and corridors darker, but I matched the game's existing style where walls are near-black and corridors are dark gray, so the editor preview is faithful to what the player sees.

## 3. AI tool usage

I used Claude Code throughout the project as an implementation partner, not as an autonomous agent.

**What AI wrote (with my direction):**
- The initial editor scaffold — component structure, canvas setup, API integration, basic tool switching. I then tested it, identified issues, and iterated.
- Performance optimizations — after I diagnosed each bottleneck (cursor lag, compositor issues with large scrollable areas), I discussed solutions with Claude and had it implement the fixes (overlay canvas, virtual panning).
- CSS and template markup — ribbon layout, modal dialogs, help content.

**What I directed and designed:**
- The overall UX concept — ribbon toolbar layout (inspired by Autodesk/Office), tool grouping, which actions belong where.
- The drag-to-direct interaction for spawn placement.
- Performance diagnosis — I tested at various board sizes and zoom levels, identified the correlation between world div size and lag, and guided the solution toward virtual panning based on how infinite-canvas tools like Figma work.
- The decision to remove right-click erase (risk of accidental deletion) and Ctrl+Shift+Z (redundant with Ctrl+Y).

**What AI suggested that I refused:**
- **Grid resize (add/remove rows and columns)** — Claude proposed this, but I rejected it because resizing could violate the generator's placement rules for power pellets (near corners) and ghost spawns, creating invalid boards silently.
- **Backend modifications for custom level names** — I chose to keep the backend unchanged and work within its existing API.
- **Over-engineered architecture** — suggestions to split the single-file component into multiple composables and a Pinia store. The current scope doesn't warrant that complexity.

## 4. Future directions

Several ideas came up during development that are worth exploring:

- **Area select tool** — rectangle or lasso selection to quickly fill, erase, or move groups of tiles.
- **Copy and paste** — duplicate a painted region (e.g., a block of walls) to speed up level design.
- **Empty board generation** — currently you generate a random board and clear it; a direct "new blank board" with a size picker would be cleaner.
- **Symmetrical generation** — the classic Pac-Man board is horizontally symmetric. A generator mode that mirrors one half would produce more natural-looking levels.
- **Level selection in the game** — let players choose from saved levels in the game UI, closing the loop between editor and gameplay.
