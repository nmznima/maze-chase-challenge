<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
import { Direction } from "../game/engine/board.ts";
import { drawGhost, drawPellet, drawPlayer, drawPowerPellet } from "../game/rendering.ts";
import { CellKind } from "./model.ts";

const props = defineProps<{ kind: CellKind; direction?: number }>();
const canvas = ref<HTMLCanvasElement>();

function render(): void {
  const element = canvas.value;
  const ctx = element?.getContext("2d");
  if (!element || !ctx) return;
  ctx.clearRect(0, 0, element.width, element.height);
  const center = element.width / 2;
  if (props.kind === CellKind.Wall) {
    ctx.fillStyle = "#334155"; ctx.fillRect(7, 7, 26, 26);
    ctx.strokeStyle = "#64748b"; ctx.strokeRect(7.5, 7.5, 25, 25);
  } else if (props.kind === CellKind.Empty) {
    ctx.strokeStyle = "#64748b"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(9, 9); ctx.lineTo(31, 31); ctx.moveTo(31, 9); ctx.lineTo(9, 31); ctx.stroke();
  } else if (props.kind === CellKind.Pellet) drawPellet(ctx, center, center, 38);
  else if (props.kind === CellKind.PowerPellet) drawPowerPellet(ctx, center, center, 33, 18);
  else if (props.kind === CellKind.Player) drawPlayer(ctx, center, center, 38, (props.direction ?? Direction.RIGHT) as Direction, "#ffeb3b");
  else if (props.kind === CellKind.Ghost) drawGhost(ctx, center, center, 38);
}

onMounted(render);
watch(() => [props.kind, props.direction], () => void nextTick(render));
</script>

<template><canvas ref="canvas" width="40" height="40" aria-hidden="true" /></template>
