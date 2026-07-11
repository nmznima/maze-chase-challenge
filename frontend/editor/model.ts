export const enum CellKind {
  Empty,
  Wall,
  Pellet,
  PowerPellet,
  Player,
  Ghost,
}

export const enum SpawnDirection {
  Up,
  Right,
  Down,
  Left,
}

export type Tool = CellKind;

export class LevelGrid {
  readonly cells: Uint8Array;
  readonly directions: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    cells = new Uint8Array(width * height),
    directions = new Uint8Array(width * height),
  ) {
    if (width < 1 || height < 1 || cells.length !== width * height) {
      throw new Error("Invalid level dimensions");
    }
    this.cells = cells;
    this.directions = directions;
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  clone(): LevelGrid {
    return new LevelGrid(this.width, this.height, this.cells.slice(), this.directions.slice());
  }
}

export type CellChange = { index: number; before: number; beforeDirection: number; after: number; afterDirection: number };

export function setCell(grid: LevelGrid, x: number, y: number, kind: CellKind, direction: SpawnDirection): CellChange | null {
  if (!grid.inBounds(x, y)) return null;
  const index = grid.index(x, y);
  const before = grid.cells[index]!;
  const beforeDirection = grid.directions[index]!;
  if (before === kind && beforeDirection === direction) return null;
  grid.cells[index] = kind;
  grid.directions[index] = direction;
  return { index, before, beforeDirection, after: kind, afterDirection: direction };
}

export function applyChanges(grid: LevelGrid, changes: readonly CellChange[], reverse = false): void {
  for (const change of changes) {
    grid.cells[change.index] = reverse ? change.before : change.after;
    grid.directions[change.index] = reverse ? change.beforeDirection : change.afterDirection;
  }
}

export function lineCells(fromX: number, fromY: number, toX: number, toY: number): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  let x = fromX, y = fromY;
  const dx = Math.abs(toX - fromX), sx = fromX < toX ? 1 : -1;
  const dy = -Math.abs(toY - fromY), sy = fromY < toY ? 1 : -1;
  let error = dx + dy;
  while (true) {
    cells.push([x, y]);
    if (x === toX && y === toY) return cells;
    const twice = 2 * error;
    if (twice >= dy) { error += dy; x += sx; }
    if (twice <= dx) { error += dx; y += sy; }
  }
}

export function warnings(grid: LevelGrid): string[] {
  let players = 0, pellets = 0;
  for (const kind of grid.cells) {
    if (kind === CellKind.Player) players += 1;
    if (kind === CellKind.Pellet || kind === CellKind.PowerPellet) pellets += 1;
  }
  const result: string[] = [];
  if (players === 0) result.push("No player spawn");
  if (pellets === 0) result.push("No pellets");
  return result;
}
