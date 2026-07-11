import { Direction } from "./engine/board.ts";

/** Canvas primitives shared by the playable game and level editor. */
export function drawGhost(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const radius = size * 0.4, totalHeight = size * 0.88;
  const top = y - totalHeight / 2, bottom = y + totalHeight / 2;
  const left = x - radius, right = x + radius, domeCenterY = top + radius;
  const feet = 3, footWidth = (radius * 2) / feet, footNotch = size * 0.14;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath(); ctx.arc(x, domeCenterY, radius, Math.PI, 0, false); ctx.lineTo(right, bottom);
  for (let i = 0; i < feet; i++) {
    const footRight = right - i * footWidth;
    ctx.lineTo(footRight - footWidth / 2, bottom - footNotch); ctx.lineTo(footRight - footWidth, bottom);
  }
  ctx.lineTo(left, domeCenterY); ctx.closePath(); ctx.fill();
}

export function drawPowerPellet(ctx: CanvasRenderingContext2D, cx: number, cy: number, length: number, thickness: number): void {
  const r = thickness / 2, left = -length / 2, right = length / 2, top = -r;
  ctx.save(); ctx.translate(cx, cy); ctx.rotate((30 * Math.PI) / 180);
  ctx.beginPath(); ctx.moveTo(left + r, top); ctx.lineTo(right - r, top); ctx.arc(right - r, 0, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(left + r, r); ctx.arc(left + r, 0, r, Math.PI / 2, -Math.PI / 2); ctx.closePath();
  ctx.save(); ctx.clip(); ctx.fillStyle = "#e53935"; ctx.fillRect(left, top, length / 2, thickness); ctx.fillStyle = "#ffd54f"; ctx.fillRect(0, top, length / 2, thickness); ctx.restore();
  ctx.strokeStyle = "#1a1a1a"; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
}

export function drawPellet(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(x, y, size / 10, 0, Math.PI * 2); ctx.fill();
}

export function drawPlayer(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, direction: Direction, color: string, phase = 0): void {
  const openingCenter = direction === Direction.UP ? -Math.PI / 2 : direction === Direction.RIGHT ? 0 : direction === Direction.DOWN ? Math.PI / 2 : Math.PI;
  const openingWidth = ((45 - 45 * phase) * Math.PI) / 180;
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x, y);
  ctx.arc(x, y, (size / 2) * 0.9, openingCenter + openingWidth, openingCenter + Math.PI * 2 - openingWidth);
  ctx.closePath(); ctx.fill();
}
