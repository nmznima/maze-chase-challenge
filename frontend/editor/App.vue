<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { generateLevel, listLevels, loadLevel, storeLevel } from "./api.ts";
import { CellKind, type CellChange, LevelGrid, lineCells, applyChanges, setCell, SpawnDirection } from "./model.ts";
import { drawGhost, drawPellet, drawPlayer, drawPowerPellet } from "../game/rendering.ts";
import { Direction } from "../game/engine/board.ts";
import ToolIcon from "./ToolIcon.vue";

const canvas = ref<HTMLCanvasElement>();
const overlay = ref<HTMLCanvasElement>();
const viewport = ref<HTMLDivElement>();
const grid = ref<LevelGrid | null>(null);
const levelIds = ref<string[]>([]);
const levelId = ref<string | undefined>();
const version = ref<number | undefined>();
const selectedLevel = ref("classic");
const tool = ref<CellKind>(CellKind.Wall);
const direction = ref(SpawnDirection.Right);
const cellSize = ref(20);
const seed = ref(42);
const size = ref(31);
const saveState = ref<"loading" | "saved" | "saving" | "unsaved" | "offline" | "conflict">("loading");
const message = ref("");
const showGenerateModal = ref(false);
const cursor = ref<[number, number] | null>(null);
const undoStack: CellChange[][] = [];
const redoStack: CellChange[][] = [];
let revision = 0, acknowledgedRevision = 0, saveTimer = 0, saving = false;
let drawing = false, previousCell: [number, number] | null = null, gesture = new Map<number, CellChange>();
let drawScheduled = false, dirtyFull = true;
const dirtyCells = new Set<number>();
let panX = 0, panY = 0;

const labels: Record<CellKind, string> = {
  [CellKind.Empty]: "Erase", [CellKind.Wall]: "Wall", [CellKind.Pellet]: "Pellet",
  [CellKind.PowerPellet]: "Power pellet", [CellKind.Player]: "Player", [CellKind.Ghost]: "Ghost",
};
const toolList = [CellKind.Wall, CellKind.Pellet, CellKind.PowerPellet, CellKind.Player, CellKind.Ghost, CellKind.Empty];
const playerCount = ref(0);
const pelletCount = ref(0);
const warningText = computed(() => {
  const result: string[] = [];
  if (playerCount.value === 0) result.push("No player spawn");
  if (pelletCount.value === 0) result.push("No pellets");
  return result;
});
const dimensions = computed(() => grid.value ? `${grid.value.width} × ${grid.value.height}` : "—");
const canUndo = computed(() => undoStack.length > 0);
const canRedo = computed(() => redoStack.length > 0);

// Bun's dev server does not transform `new URL(..., import.meta.url)` worker
// references, so the editor server exposes this module at an explicit URL.
const worker = new Worker("/codec.worker.js", { type: "module" });
let decodeResolve: ((value: LevelGrid) => void) | undefined;
const encodeResolves = new Map<number, (value: string) => void>();
let encodeId = 0;
worker.onmessage = (event: MessageEvent<any>) => {
  const data = event.data;
  if (data.type === "decoded" && decodeResolve) {
    const resolve = decodeResolve; decodeResolve = undefined;
    resolve(new LevelGrid(data.width, data.height, new Uint8Array(data.cells), new Uint8Array(data.directions)));
  } else if (data.type === "encoded") {
    encodeResolves.get(data.id)?.(data.text); encodeResolves.delete(data.id);
  } else if (data.type === "error") {
    message.value = data.message;
  }
};

function decode(text: string): Promise<LevelGrid> {
  return new Promise((resolve) => { decodeResolve = resolve; worker.postMessage({ type: "decode", text }); });
}
function encode(value: LevelGrid): Promise<string> {
  const id = ++encodeId, copy = value.clone();
  return new Promise((resolve) => {
    encodeResolves.set(id, resolve);
    worker.postMessage({ type: "encode", id, width: copy.width, height: copy.height, cells: copy.cells.buffer, directions: copy.directions.buffer }, [copy.cells.buffer, copy.directions.buffer]);
  });
}

function recount(g: LevelGrid): void {
  let players = 0, pellets = 0;
  for (const kind of g.cells) {
    if (kind === CellKind.Player) players++;
    if (kind === CellKind.Pellet || kind === CellKind.PowerPellet) pellets++;
  }
  playerCount.value = players; pelletCount.value = pellets;
}
function adjustCounts(before: number, after: number): void {
  if (before === after) return;
  if (before === CellKind.Player) playerCount.value--;
  else if (before === CellKind.Pellet || before === CellKind.PowerPellet) pelletCount.value--;
  if (after === CellKind.Player) playerCount.value++;
  else if (after === CellKind.Pellet || after === CellKind.PowerPellet) pelletCount.value++;
}

function clampPan(): void {
  const host = viewport.value, value = grid.value; if (!host || !value) return;
  const maxX = Math.max(0, value.width * cellSize.value - host.clientWidth);
  const maxY = Math.max(0, value.height * cellSize.value - host.clientHeight);
  panX = Math.max(0, Math.min(panX, maxX));
  panY = Math.max(0, Math.min(panY, maxY));
}
function onWheel(event: WheelEvent): void {
  event.preventDefault();
  panX += event.deltaX; panY += event.deltaY;
  clampPan(); draw();
}

async function install(text: string, identity?: { id: string; version: number }): Promise<void> {
  grid.value = await decode(text);
  recount(grid.value);
  levelId.value = identity?.id; version.value = identity?.version;
  revision = 0; acknowledgedRevision = 0; undoStack.length = 0; redoStack.length = 0;
  panX = 0; panY = 0;
  saveState.value = "saved"; message.value = "";
  await nextTick(); draw();
}

async function refreshLevels(): Promise<void> { levelIds.value = await listLevels(); }
async function openLevel(id = selectedLevel.value): Promise<void> {
  saveState.value = "loading"; message.value = "Loading level…";
  try { const level = await loadLevel(id); selectedLevel.value = id; await install(level.ascii2d, level); }
  catch (error) { saveState.value = "offline"; message.value = error instanceof Error ? error.message : "Could not load level"; }
}
async function generate(): Promise<void> {
  if (!Number.isInteger(size.value) || size.value < 15 || size.value > 1000) { message.value = "Size must be an integer from 15 to 1000."; return; }
  showGenerateModal.value = false;
  saveState.value = "loading"; message.value = "Generating level…";
  try { const result = await generateLevel(seed.value, size.value); selectedLevel.value = ""; await install(result.ascii2d); message.value = "Generated draft — save to create it."; saveState.value = "unsaved"; }
  catch (error) { saveState.value = "offline"; message.value = error instanceof Error ? error.message : "Could not generate level"; }
}

function markChanged(): void {
  revision += 1; saveState.value = "unsaved"; message.value = ""; draw();
  window.clearTimeout(saveTimer); saveTimer = window.setTimeout(() => void save(), 350);
}
async function save(): Promise<void> {
  if (!grid.value || saving || saveState.value === "conflict") return;
  if (revision === acknowledgedRevision && levelId.value) return;
  saving = true; saveState.value = "saving";
  const targetRevision = revision;
  const snapshot = await encode(grid.value);
  const attemptedId = levelId.value;
  try {
    const stored = await storeLevel(snapshot, attemptedId, version.value);
    levelId.value = stored.id; version.value = stored.version; selectedLevel.value = stored.id;
    acknowledgedRevision = targetRevision; saveState.value = revision === targetRevision ? "saved" : "unsaved";
    await refreshLevels();
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    if (attemptedId && (status === 409 || status === undefined)) {
      try {
        const authoritative = await loadLevel(attemptedId);
        if (authoritative.ascii2d === snapshot) {
          levelId.value = authoritative.id; version.value = authoritative.version; acknowledgedRevision = targetRevision;
          saveState.value = revision === targetRevision ? "saved" : "unsaved";
        } else {
          saveState.value = "conflict"; message.value = "Server level changed. Your local board is still visible; reload to use the server version.";
        }
      } catch { saveState.value = "offline"; message.value = "Save is unconfirmed. Keep this tab open and try Save again."; }
    } else { saveState.value = "offline"; message.value = error instanceof Error ? error.message : "Save failed"; }
  } finally {
    saving = false;
    if (saveState.value === "unsaved" && revision > acknowledgedRevision) void save();
  }
}

function point(event: PointerEvent): [number, number] | null {
  const value = grid.value, element = viewport.value;
  if (!value || !element) return null;
  const rect = element.getBoundingClientRect();
  const x = Math.floor((event.clientX - rect.left + panX) / cellSize.value);
  const y = Math.floor((event.clientY - rect.top + panY) / cellSize.value);
  return value.inBounds(x, y) ? [x, y] : null;
}
function paint(x: number, y: number, selectedTool = tool.value): void {
  const value = grid.value; if (!value) return;
  const change = setCell(value, x, y, selectedTool, direction.value);
  if (!change) return;
  adjustCounts(change.before, change.after);
  dirtyCells.add(change.index);
  const existing = gesture.get(change.index);
  gesture.set(change.index, existing ? { ...change, before: existing.before, beforeDirection: existing.beforeDirection } : change);
}
function drawOverlay(): void {
  const el = overlay.value, host = viewport.value; if (!el || !host) return;
  const ratio = window.devicePixelRatio || 1, width = host.clientWidth, height = host.clientHeight;
  if (el.width !== width * ratio || el.height !== height * ratio) { el.width = width * ratio; el.height = height * ratio; el.style.width = `${width}px`; el.style.height = `${height}px`; }
  const ctx = el.getContext("2d"); if (!ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
  if (!cursor.value) return;
  const [x, y] = cursor.value, cs = cellSize.value;
  ctx.strokeStyle = "#38bdf8"; ctx.lineWidth = 2;
  ctx.strokeRect(x * cs - panX + 1, y * cs - panY + 1, cs - 2, cs - 2);
}
function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0 && event.button !== 2) return;
  const cell = point(event); if (!cell) return;
  event.preventDefault(); drawing = true; gesture.clear(); previousCell = cell;
  paint(cell[0], cell[1], event.button === 2 ? CellKind.Empty : tool.value);
  cursor.value = cell; drawOverlay(); scheduleFrame();
  viewport.value?.setPointerCapture(event.pointerId);
}
function onPointerMove(event: PointerEvent): void {
  const cell = point(event);
  cursor.value = cell; drawOverlay();
  if (!drawing || !cell || !previousCell) return;
  for (const [x, y] of lineCells(previousCell[0], previousCell[1], cell[0], cell[1])) paint(x, y, event.buttons === 2 ? CellKind.Empty : tool.value);
  previousCell = cell; scheduleFrame();
}
function finishGesture(): void {
  if (!drawing) return; drawing = false; previousCell = null;
  const changes = [...gesture.values()]; gesture.clear();
  if (changes.length) { undoStack.push(changes); if (undoStack.length > 80) undoStack.shift(); redoStack.length = 0; markChanged(); }
}
function undo(): void { const changes = undoStack.pop(); if (!changes || !grid.value) return; applyChanges(grid.value, changes, true); for (const c of changes) adjustCounts(c.after, c.before); redoStack.push(changes); markChanged(); }
function redo(): void { const changes = redoStack.pop(); if (!changes || !grid.value) return; applyChanges(grid.value, changes); for (const c of changes) adjustCounts(c.before, c.after); undoStack.push(changes); markChanged(); }
function clearMap(): void {
  const value = grid.value; if (!value) return;
  const changes: CellChange[] = [];
  for (let i = 0; i < value.cells.length; i++) {
    const before = value.cells[i]!, beforeDir = value.directions[i]!;
    if (before === CellKind.Empty && beforeDir === 0) continue;
    changes.push({ index: i, before, beforeDirection: beforeDir, after: CellKind.Empty, afterDirection: 0 });
    value.cells[i] = CellKind.Empty; value.directions[i] = 0;
  }
  if (!changes.length) return;
  for (const c of changes) adjustCounts(c.before, c.after);
  undoStack.push(changes); if (undoStack.length > 80) undoStack.shift(); redoStack.length = 0;
  markChanged();
}

function draw(): void { dirtyFull = true; scheduleFrame(); }
function scheduleFrame(): void {
  if (drawScheduled) return;
  drawScheduled = true;
  requestAnimationFrame(render);
}

function renderCell(ctx: CanvasRenderingContext2D, value: LevelGrid, x: number, y: number, scrollLeft: number, scrollTop: number, cs: number): void {
  const px = x * cs - scrollLeft, py = y * cs - scrollTop, kind = value.cells[value.index(x, y)]!;
  ctx.fillStyle = kind === CellKind.Wall ? "#334155" : "#0f172a"; ctx.fillRect(px, py, cs, cs);
  const centerX = px + cs / 2, centerY = py + cs / 2;
  if (kind === CellKind.Pellet) drawPellet(ctx, centerX, centerY, cs);
  if (kind === CellKind.PowerPellet) drawPowerPellet(ctx, centerX, centerY, cs * .9, cs * .5);
  if (kind === CellKind.Ghost) drawGhost(ctx, centerX, centerY, cs);
  if (kind === CellKind.Player) drawPlayer(ctx, centerX, centerY, cs, value.directions[value.index(x, y)]! as Direction, "#ffeb3b");
  if (cs >= 16) { ctx.strokeStyle = "#1e293b"; ctx.strokeRect(px, py, cs, cs); }
}

function render(): void {
  drawScheduled = false;
  const element = canvas.value, host = viewport.value, value = grid.value; if (!element || !host || !value) return;
  const ratio = window.devicePixelRatio || 1, width = host.clientWidth, height = host.clientHeight;
  const cs = cellSize.value;
  if (element.width !== width * ratio || element.height !== height * ratio) { element.width = width * ratio; element.height = height * ratio; element.style.width = `${width}px`; element.style.height = `${height}px`; dirtyFull = true; }
  const ctx = element.getContext("2d"); if (!ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  if (dirtyFull) {
    dirtyFull = false; dirtyCells.clear();
    ctx.fillStyle = "#111827"; ctx.fillRect(0, 0, width, height);
    const left = Math.max(0, Math.floor(panX / cs)), top = Math.max(0, Math.floor(panY / cs));
    const right = Math.min(value.width, Math.ceil((panX + width) / cs)), bottom = Math.min(value.height, Math.ceil((panY + height) / cs));
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) renderCell(ctx, value, x, y, panX, panY, cs);
    drawOverlay();
    return;
  }

  if (dirtyCells.size > 0) {
    const left = Math.floor(panX / cs), top = Math.floor(panY / cs);
    const right = Math.ceil((panX + width) / cs), bottom = Math.ceil((panY + height) / cs);
    for (const idx of dirtyCells) {
      const x = idx % value.width, y = (idx - x) / value.width;
      if (x >= left && x < right && y >= top && y < bottom) renderCell(ctx, value, x, y, panX, panY, cs);
    }
    dirtyCells.clear();
  }
}
function keyboard(event: KeyboardEvent): void {
  if (event.key === "Escape" && showGenerateModal.value) { showGenerateModal.value = false; return; }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void save(); }
}
function beforeUnload(event: BeforeUnloadEvent): void { if (saveState.value === "unsaved" || saveState.value === "saving") event.preventDefault(); }
onMounted(async () => { window.addEventListener("keydown", keyboard); window.addEventListener("resize", draw); window.addEventListener("beforeunload", beforeUnload); try { await refreshLevels(); } catch { /* opening the classic level will show the connection error */ } await openLevel("classic"); });
onBeforeUnmount(() => { window.clearTimeout(saveTimer); worker.terminate(); window.removeEventListener("keydown", keyboard); window.removeEventListener("resize", draw); window.removeEventListener("beforeunload", beforeUnload); });
</script>

<template>
  <main>
    <header><div class="header-left"><h1>Maze Chase Editor</h1><select v-model="selectedLevel" @change="openLevel()"><option v-for="id in levelIds" :key="id" :value="id">{{ id === "classic" ? "classic" : id.slice(0, 8) }}</option></select><div class="status" :data-state="saveState">{{ saveState }}</div></div><p class="header-info">Size: {{ dimensions }} | Position: {{ cursor ? `${cursor[0]}, ${cursor[1]}` : "—" }}</p></header>
    <section class="ribbon" aria-label="Editing tools">
      <div class="ribbon-group">
        <span class="ribbon-title">Actions</span>
        <button class="command-button" @click="showGenerateModal = true"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg><span>New</span></button>
        <button class="command-button" @click="openLevel()"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg><span>Reload</span></button>
        <button class="command-button" @click="clearMap"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg><span>Clear All</span></button>
        <button class="command-button" @click="save" :disabled="saveState === 'saving' || saveState === 'conflict'"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor"><path d="M840-680v480q0 33-23.5 56.5T760-120H200q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h480l160 160Zm-80 34L646-760H200v560h560v-446ZM565-275q35-35 35-85t-35-85q-35-35-85-35t-85 35q-35 35-35 85t35 85q35 35 85 35t85-35ZM240-560h360v-160H240v160Zm-40-86v446-560 114Z"/></svg><span>Save</span></button>
      </div>
      <div class="ribbon-group">
        <span class="ribbon-title">Tiles</span>
        <button v-for="item in toolList" :key="item" class="tool-button" :class="{ active: tool === item }" :aria-pressed="tool === item" @click="tool = item">
          <ToolIcon :kind="item" :direction="direction" /><span>{{ labels[item] }}</span>
        </button>
      </div>
      <div v-if="tool === CellKind.Player || tool === CellKind.Ghost" class="ribbon-group">
        <span class="ribbon-title">Spawn direction</span>
        <button v-for="(name, value) in ['↑','→','↓','←']" :key="name" class="direction-button" :class="{ active: direction === value }" :aria-label="`Face ${name}`" @click="direction = value">{{ name }}</button>
      </div>
      <div class="ribbon-group">
        <span class="ribbon-title">Zoom</span>
        <button class="command-button" @click="cellSize = Math.max(8, cellSize - 4); clampPan(); draw()"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607ZM13.5 10.5h-6" /></svg><span>Out</span></button><button class="command-button" @click="cellSize = Math.min(40, cellSize + 4); clampPan(); draw()"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607ZM10.5 7.5v6m3-3h-6" /></svg><span>In</span></button>
      </div>
      <p class="ribbon-info">Drag to paint · Right-click erases · Scroll to pan · ⌘Z undo · ⌘S saves</p>
    </section>
    <section class="workspace">
      <div ref="viewport" class="viewport" @wheel="onWheel" @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="finishGesture" @pointercancel="finishGesture" @contextmenu.prevent><canvas ref="canvas"></canvas><canvas ref="overlay" class="overlay"></canvas></div>
    </section>
    <footer v-if="message || warningText.length"><span v-if="message">{{ message }}</span><span v-if="warningText.length">Warnings: {{ warningText.join(" · ") }}</span></footer>
    <div v-if="showGenerateModal" class="modal-backdrop" @click.self="showGenerateModal = false">
      <div class="modal">
        <h2>Generate New Map</h2>
        <label>Seed <input v-model.number="seed" type="number" /></label>
        <label>Size <input v-model.number="size" type="number" min="15" max="1000" /></label>
        <div class="modal-actions">
          <button @click="generate">Generate</button>
          <button @click="showGenerateModal = false">Cancel</button>
        </div>
      </div>
    </div>
  </main>
</template>
