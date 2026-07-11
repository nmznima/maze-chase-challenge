<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { generateLevel, listLevels, loadLevel, storeLevel } from "./api.ts";
import { CellKind, type CellChange, LevelGrid, lineCells, applyChanges, setCell, SpawnDirection, warnings } from "./model.ts";

const canvas = ref<HTMLCanvasElement>();
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
const cursor = ref<[number, number] | null>(null);
const undoStack: CellChange[][] = [];
const redoStack: CellChange[][] = [];
let revision = 0, acknowledgedRevision = 0, saveTimer = 0, saving = false;
let drawing = false, previousCell: [number, number] | null = null, gesture = new Map<number, CellChange>();

const labels: Record<CellKind, string> = {
  [CellKind.Empty]: "Erase", [CellKind.Wall]: "Wall", [CellKind.Pellet]: "Pellet",
  [CellKind.PowerPellet]: "Power pellet", [CellKind.Player]: "Player", [CellKind.Ghost]: "Ghost",
};
const toolList = [CellKind.Wall, CellKind.Empty, CellKind.Pellet, CellKind.PowerPellet, CellKind.Player, CellKind.Ghost];
const warningText = computed(() => grid.value ? warnings(grid.value) : []);
const dimensions = computed(() => grid.value ? `${grid.value.width} × ${grid.value.height}` : "—");
const worldStyle = computed(() => grid.value ? { width: `${grid.value.width * cellSize.value}px`, height: `${grid.value.height * cellSize.value}px` } : {});
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

async function install(text: string, identity?: { id: string; version: number }): Promise<void> {
  grid.value = await decode(text);
  levelId.value = identity?.id; version.value = identity?.version;
  revision = 0; acknowledgedRevision = 0; undoStack.length = 0; redoStack.length = 0;
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
  const x = Math.floor((event.clientX - rect.left + element.scrollLeft) / cellSize.value);
  const y = Math.floor((event.clientY - rect.top + element.scrollTop) / cellSize.value);
  return value.inBounds(x, y) ? [x, y] : null;
}
function paint(x: number, y: number, selectedTool = tool.value): void {
  const value = grid.value; if (!value) return;
  const change = setCell(value, x, y, selectedTool, direction.value);
  if (!change) return;
  const existing = gesture.get(change.index);
  gesture.set(change.index, existing ? { ...change, before: existing.before, beforeDirection: existing.beforeDirection } : change);
}
function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0 && event.button !== 2) return;
  const cell = point(event); if (!cell) return;
  event.preventDefault(); drawing = true; gesture.clear(); previousCell = cell;
  paint(cell[0], cell[1], event.button === 2 ? CellKind.Empty : tool.value); viewport.value?.setPointerCapture(event.pointerId); draw();
}
function onPointerMove(event: PointerEvent): void {
  const cell = point(event); cursor.value = cell; if (!drawing || !cell || !previousCell) { draw(); return; }
  for (const [x, y] of lineCells(previousCell[0], previousCell[1], cell[0], cell[1])) paint(x, y, event.buttons === 2 ? CellKind.Empty : tool.value);
  previousCell = cell; draw();
}
function finishGesture(): void {
  if (!drawing) return; drawing = false; previousCell = null;
  const changes = [...gesture.values()]; gesture.clear();
  if (changes.length) { undoStack.push(changes); if (undoStack.length > 80) undoStack.shift(); redoStack.length = 0; markChanged(); }
}
function undo(): void { const changes = undoStack.pop(); if (!changes || !grid.value) return; applyChanges(grid.value, changes, true); redoStack.push(changes); markChanged(); }
function redo(): void { const changes = redoStack.pop(); if (!changes || !grid.value) return; applyChanges(grid.value, changes); undoStack.push(changes); markChanged(); }

function draw(): void {
  const element = canvas.value, host = viewport.value, value = grid.value; if (!element || !host || !value) return;
  const ratio = window.devicePixelRatio || 1, width = host.clientWidth, height = host.clientHeight;
  if (element.width !== width * ratio || element.height !== height * ratio) { element.width = width * ratio; element.height = height * ratio; element.style.width = `${width}px`; element.style.height = `${height}px`; }
  element.style.transform = `translate(${host.scrollLeft}px, ${host.scrollTop}px)`;
  const ctx = element.getContext("2d"); if (!ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.fillStyle = "#111827"; ctx.fillRect(0, 0, width, height);
  const left = Math.max(0, Math.floor(host.scrollLeft / cellSize.value)), top = Math.max(0, Math.floor(host.scrollTop / cellSize.value));
  const right = Math.min(value.width, Math.ceil((host.scrollLeft + width) / cellSize.value)), bottom = Math.min(value.height, Math.ceil((host.scrollTop + height) / cellSize.value));
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    const px = x * cellSize.value - host.scrollLeft, py = y * cellSize.value - host.scrollTop, kind = value.cells[value.index(x, y)]!;
    ctx.fillStyle = kind === CellKind.Wall ? "#334155" : "#0f172a"; ctx.fillRect(px, py, cellSize.value, cellSize.value);
    if (kind === CellKind.Pellet || kind === CellKind.PowerPellet) { ctx.fillStyle = kind === CellKind.Pellet ? "#f8fafc" : "#fbbf24"; ctx.beginPath(); ctx.arc(px + cellSize.value / 2, py + cellSize.value / 2, kind === CellKind.Pellet ? Math.max(1.5, cellSize.value / 8) : Math.max(3, cellSize.value / 3), 0, Math.PI * 2); ctx.fill(); }
    if (kind === CellKind.Player || kind === CellKind.Ghost) { ctx.fillStyle = kind === CellKind.Player ? "#fde047" : "#fb7185"; ctx.font = `${Math.max(9, cellSize.value * .72)}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(kind === CellKind.Player ? "P" : "G", px + cellSize.value / 2, py + cellSize.value / 2 + 1); }
    if (cellSize.value >= 16) { ctx.strokeStyle = "#1e293b"; ctx.strokeRect(px, py, cellSize.value, cellSize.value); }
  }
  if (cursor.value) { const [x, y] = cursor.value; ctx.strokeStyle = "#38bdf8"; ctx.lineWidth = 2; ctx.strokeRect(x * cellSize.value - host.scrollLeft + 1, y * cellSize.value - host.scrollTop + 1, cellSize.value - 2, cellSize.value - 2); }
}
function keyboard(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void save(); }
}
onMounted(async () => { window.addEventListener("keydown", keyboard); window.addEventListener("resize", draw); try { await refreshLevels(); } catch { /* opening the classic level will show the connection error */ } await openLevel("classic"); });
onBeforeUnmount(() => { window.clearTimeout(saveTimer); worker.terminate(); window.removeEventListener("keydown", keyboard); window.removeEventListener("resize", draw); });
</script>

<template>
  <main>
    <header><div><h1>Maze Chase editor</h1><p>{{ dimensions }} · {{ cursor ? `${cursor[0]}, ${cursor[1]}` : "Move over the board" }}</p></div><div class="status" :data-state="saveState">{{ saveState }}</div></header>
    <section class="toolbar">
      <label>Level <select v-model="selectedLevel" @change="openLevel()"><option v-for="id in levelIds" :key="id" :value="id">{{ id === "classic" ? "classic" : id.slice(0, 8) }}</option></select></label>
      <button @click="openLevel()">Reload server</button><button @click="save" :disabled="saveState === 'saving' || saveState === 'conflict'">Save</button>
      <label>Seed <input v-model.number="seed" type="number" /></label><label>Size <input v-model.number="size" type="number" min="15" max="1000" /></label><button @click="generate">Generate draft</button>
    </section>
    <section class="workspace">
      <aside><h2>Paint</h2><button v-for="item in toolList" :key="item" :class="{ active: tool === item }" @click="tool = item">{{ labels[item] }}</button><template v-if="tool === CellKind.Player || tool === CellKind.Ghost"><h2>Direction</h2><div class="directions"><button v-for="(name, value) in ['↑','→','↓','←']" :key="name" :class="{ active: direction === value }" @click="direction = value">{{ name }}</button></div></template><h2>History</h2><button :disabled="!canUndo" @click="undo">Undo</button><button :disabled="!canRedo" @click="redo">Redo</button><h2>Zoom</h2><div class="zoom"><button @click="cellSize = Math.max(8, cellSize - 4); draw()">−</button><span>{{ cellSize }}px</span><button @click="cellSize = Math.min(40, cellSize + 4); draw()">+</button></div><p class="hint">Drag to paint. Right-click erases. ⌘/Ctrl+S saves.</p></aside>
      <div ref="viewport" class="viewport" @scroll="draw" @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="finishGesture" @pointercancel="finishGesture" @contextmenu.prevent><div class="world" :style="worldStyle"></div><canvas ref="canvas"></canvas></div>
    </section>
    <footer v-if="message || warningText.length"><span v-if="message">{{ message }}</span><span v-if="warningText.length">Warnings: {{ warningText.join(" · ") }}</span></footer>
  </main>
</template>
