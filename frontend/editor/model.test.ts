import { expect, test } from "bun:test";
import { applyChanges, CellKind, LevelGrid, lineCells, setCell, SpawnDirection, warnings } from "./model.ts";

test("drag line visits every intermediate cell", () => {
  expect(lineCells(0, 0, 4, 2)).toEqual([[0, 0], [1, 1], [2, 1], [3, 2], [4, 2]]);
});

test("cell changes undo without copying the board", () => {
  const grid = new LevelGrid(3, 3);
  const change = setCell(grid, 1, 1, CellKind.Player, SpawnDirection.Left)!;
  applyChanges(grid, [change], true);
  expect(grid.cells[4]).toBe(CellKind.Empty);
  applyChanges(grid, [change]);
  expect(grid.cells[4]).toBe(CellKind.Player);
  expect(grid.directions[4]).toBe(SpawnDirection.Left);
});

test("warnings identify likely non-playable draft", () => {
  expect(warnings(new LevelGrid(2, 2))).toEqual(["No player spawn", "No pellets"]);
});
