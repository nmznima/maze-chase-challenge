<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";

import {
  CLASSIC,
  Direction,
  Engine,
  div,
  frac,
  fromNum,
  isPoweredUp,
  toNum,
  type Ghost,
  type Player,
  type Pellet,
  type PowerPellet,
} from "./engine/index.ts";
import {
  drawGhost as drawSharedGhost,
  drawPellet,
  drawPlayer,
  drawPowerPellet,
} from "./rendering.ts";

const BLOCK_SIZE = 16;
const BOARD_OFFSET = 16;

// The engine ticks once per animation frame (~60fps), so ~60 ticks ≈ 1 second.
const TICKS_PER_SECOND = 60;
const POWER_BLINK_TICKS = TICKS_PER_SECOND;
const POWER_BLINK_PERIOD = 8;

const API_URL = "http://127.0.0.1:8000";
const engine = ref<Engine | null>(null);
const players = ref<readonly Player[]>([]);
const ghosts = ref<readonly Ghost[]>([]);
const pellets = ref<readonly Pellet[]>([]);
const powerPellets = ref<readonly PowerPellet[]>([]);
const levelWidth = ref(0);
const levelHeight = ref(0);
const fps = ref(0);
const heldDirection = ref<Direction | null>(null);
const levelSource = ref<"classic" | "server">("classic");
const serverLevels = ref<string[]>([]);
const selectedServerId = ref("");
const loadError = ref("");

let frameId = 0;
let lastFrameTime = 0;
let frameCount = 0;
let fpsWindowStart = 0;

const canvasWidth = computed(
  () => BOARD_OFFSET * 2 + levelWidth.value * BLOCK_SIZE,
);
const canvasHeight = computed(
  () => BOARD_OFFSET * 2 + levelHeight.value * BLOCK_SIZE + 48,
);

function syncState(): void {
  if (engine.value === null) {
    return;
  }
  players.value = engine.value.getPlayers();
  ghosts.value = engine.value.getGhosts();
  pellets.value = engine.value.getPellets();
  powerPellets.value = engine.value.getPowerPellets();
  const board = engine.value.getBoard();
  levelWidth.value = board.width;
  levelHeight.value = board.height;
}

function playerColor(player: Player): string {
  const NORMAL = "#ffeb3b";
  const POWERED = "#e53935";
  if (!isPoweredUp(player)) {
    return NORMAL;
  }
  // In the last second before power runs out, blink between the two colors.
  if (player.poweredTicks < POWER_BLINK_TICKS) {
    const on = Math.floor(player.poweredTicks / POWER_BLINK_PERIOD) % 2 === 0;
    return on ? NORMAL : POWERED;
  }
  return POWERED;
}

function draw(ctx: CanvasRenderingContext2D): void {
  if (engine.value === null) {
    return;
  }

  const board = engine.value.getBoard();
  ctx.fillStyle = "#2b2b2b";
  ctx.fillRect(0, 0, canvasWidth.value, canvasHeight.value);

  ctx.fillStyle = "#f5f5f5";
  ctx.font = "14px monospace";
  const status = `players: ${players.value.length} | ghosts: ${ghosts.value.length} | pellets: ${pellets.value.length}`;
  ctx.fillText(
    `${levelWidth.value}x${levelHeight.value} @ ${fps.value} FPS`,
    12,
    20,
  );
  ctx.fillText(status, 12, 38);

  for (let i = 0; i < board.width; i++) {
    for (let j = 0; j < board.height; j++) {
      const left = BOARD_OFFSET + i * BLOCK_SIZE;
      const top = BOARD_OFFSET + 48 + j * BLOCK_SIZE;
      if (board.hasWall(i, j)) {
        ctx.fillStyle = "#111111";
        ctx.fillRect(left, top, BLOCK_SIZE, BLOCK_SIZE);
      }
    }
  }

  ctx.strokeStyle = "#4caf50";
  ctx.lineWidth = 2;
  ctx.strokeRect(
    BOARD_OFFSET,
    BOARD_OFFSET + 48,
    board.width * BLOCK_SIZE,
    board.height * BLOCK_SIZE,
  );

  for (const pellet of pellets.value) {
    const x = BOARD_OFFSET + BLOCK_SIZE / 2 + toNum(pellet.x) * BLOCK_SIZE;
    const y = BOARD_OFFSET + 48 + BLOCK_SIZE / 2 + toNum(pellet.y) * BLOCK_SIZE;
    drawPellet(ctx, x, y, BLOCK_SIZE);
  }

  for (const powerPellet of powerPellets.value) {
    const x = BOARD_OFFSET + BLOCK_SIZE / 2 + toNum(powerPellet.x) * BLOCK_SIZE;
    const y = BOARD_OFFSET + 48 + BLOCK_SIZE / 2 + toNum(powerPellet.y) * BLOCK_SIZE;
    drawPowerPellet(ctx, x, y, BLOCK_SIZE * 0.9, BLOCK_SIZE * 0.5);
  }

  for (const ghost of ghosts.value) {
    const x = BOARD_OFFSET + BLOCK_SIZE / 2 + toNum(ghost.x) * BLOCK_SIZE;
    const y = BOARD_OFFSET + 48 + BLOCK_SIZE / 2 + toNum(ghost.y) * BLOCK_SIZE;
    drawSharedGhost(ctx, x, y, BLOCK_SIZE);
  }

  for (const player of players.value) {
    const x = BOARD_OFFSET + BLOCK_SIZE / 2 + toNum(player.x) * BLOCK_SIZE;
    const y = BOARD_OFFSET + 48 + BLOCK_SIZE / 2 + toNum(player.y) * BLOCK_SIZE;
    const phase =
      Math.abs(toNum(frac(player.x)) + toNum(frac(player.y)) - 0.5) * 2;
    drawPlayer(ctx, x, y, BLOCK_SIZE, player.current, playerColor(player), phase);
  }
}

function tickFrame(timestamp: number): void {
  if (engine.value === null) {
    return;
  }

  if (lastFrameTime > 0) {
    engine.value.tick({ direction: heldDirection.value });
    syncState();
  }
  lastFrameTime = timestamp;

  frameCount += 1;
  if (fpsWindowStart === 0) {
    fpsWindowStart = timestamp;
  }
  if (timestamp - fpsWindowStart >= 1000) {
    fps.value = frameCount;
    frameCount = 0;
    fpsWindowStart = timestamp;
  }

  const canvas = document.getElementById("game-canvas");
  if (canvas instanceof HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (ctx !== null) {
      draw(ctx);
    }
  }

  frameId = requestAnimationFrame(tickFrame);
}

function directionFromKey(key: string): Direction | null {
  if (key === "ArrowRight") {
    return Direction.RIGHT;
  }
  if (key === "ArrowLeft") {
    return Direction.LEFT;
  }
  if (key === "ArrowUp") {
    return Direction.UP;
  }
  if (key === "ArrowDown") {
    return Direction.DOWN;
  }
  return null;
}

function onKeyDown(event: KeyboardEvent): void {
  const direction = directionFromKey(event.key);
  if (direction !== null) {
    heldDirection.value = direction;
    event.preventDefault();
  }
}

function onKeyUp(event: KeyboardEvent): void {
  const direction = directionFromKey(event.key);
  if (direction !== null && heldDirection.value === direction) {
    heldDirection.value = null;
    event.preventDefault();
  }
}

function startGame(ascii2d: string): void {
  cancelAnimationFrame(frameId);
  lastFrameTime = 0; frameCount = 0; fpsWindowStart = 0;
  engine.value = new Engine(ascii2d, div(fromNum(1), fromNum(8)));
  syncState();
  frameId = requestAnimationFrame(tickFrame);
}

async function loadServerLevel(): Promise<void> {
  if (!selectedServerId.value) return;
  loadError.value = "";
  try {
    const res = await fetch(`${API_URL}/level/load?id=${encodeURIComponent(selectedServerId.value)}`);
    if (!res.ok) throw new Error(`Failed to load (${res.status})`);
    const data = await res.json();
    startGame(data.ascii2d);
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : "Failed to load level";
  }
}

async function fetchServerLevels(): Promise<void> {
  try {
    const res = await fetch(`${API_URL}/levels`);
    if (res.ok) serverLevels.value = await res.json();
  } catch { /* backend may be offline */ }
}

function onSourceChange(): void {
  loadError.value = "";
  if (levelSource.value === "classic") {
    startGame(CLASSIC);
  } else {
    fetchServerLevels();
    if (selectedServerId.value) loadServerLevel();
  }
}

onMounted(() => {
  startGame(CLASSIC);
  fetchServerLevels();
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
});

onUnmounted(() => {
  cancelAnimationFrame(frameId);
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
});
</script>

<template>
  <main class="game">
    <h1>Maze Chase</h1>
    <div class="level-picker">
      <label><input type="radio" value="classic" v-model="levelSource" @change="onSourceChange" /> Default Classic</label>
      <label><input type="radio" value="server" v-model="levelSource" @change="onSourceChange" /> From Server</label>
      <template v-if="levelSource === 'server'">
        <select v-model="selectedServerId" @change="loadServerLevel">
          <option value="" disabled>Select a level</option>
          <option v-for="id in serverLevels" :key="id" :value="id">{{ id === "classic" ? "classic" : id.slice(0, 8) }}</option>
        </select>
      </template>
    </div>
    <p v-if="loadError" class="error">{{ loadError }}</p>
    <p class="hint">Arrow keys to move</p>
    <canvas id="game-canvas" :width="canvasWidth" :height="canvasHeight" />
  </main>
</template>

<style scoped>
.game {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  min-height: 100vh;
  padding: 24px;
}

h1 {
  margin: 0;
  font-size: 1.5rem;
}

.hint {
  margin: 0;
  color: #aaaaaa;
  font-size: 0.875rem;
}

canvas {
  border: 1px solid #444444;
  background: #2b2b2b;
}

.level-picker {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 0.85rem;
  color: #ccc;
}

.level-picker label {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}

.level-picker select {
  font: inherit;
  font-size: 0.85rem;
  padding: 3px 6px;
  border: 1px solid #555;
  border-radius: 4px;
  color: #f5f5f5;
  background: #1a1a1a;
}

.error {
  margin: 0;
  color: #f87171;
  font-size: 0.8rem;
}
</style>
