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
    // rendered as SVG in template
  } else if (props.kind === CellKind.Pellet) drawPellet(ctx, center, center, 38);
  else if (props.kind === CellKind.PowerPellet) drawPowerPellet(ctx, center, center, 33, 18);
  else if (props.kind === CellKind.Player) drawPlayer(ctx, center, center, 38, (props.direction ?? Direction.RIGHT) as Direction, "#ffeb3b");
  else if (props.kind === CellKind.Ghost) drawGhost(ctx, center, center, 38);
}

onMounted(render);
watch(() => [props.kind, props.direction], () => void nextTick(render));
</script>

<template>
  <svg v-if="kind === CellKind.Empty" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M690-240h190v80H610l80-80Zm-500 80-85-85q-23-23-23.5-57t22.5-58l440-456q23-24 56.5-24t56.5 23l199 199q23 23 23 57t-23 57L520-160H190Zm296-80 314-322-198-198-442 456 64 64h262Zm-6-240Z"/></svg>
  <canvas v-else ref="canvas" width="40" height="40" aria-hidden="true" />
</template>
