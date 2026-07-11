const CellKind = { Empty: 0, Wall: 1, Pellet: 2, PowerPellet: 3, Player: 4, Ghost: 5 };
const directionChars = ["U", "R", "D", "L"];

function decode(text) {
  const lines = text.replace(/^\n/, "").split("\n").filter((line) => line.length > 0);
  if (lines.length === 0) throw new Error("Level is empty");
  const longest = Math.max(...lines.map((line) => line.length));
  if (longest % 2 !== 0) throw new Error("Level rows must use two characters per cell");
  const width = longest / 2;
  const cells = new Uint8Array(width * lines.length);
  const directions = new Uint8Array(width * lines.length);
  for (let y = 0; y < lines.length; y++) {
    const line = lines[y];
    for (let x = 0; x < width; x++) {
      const a = line[x * 2] ?? " ", b = line[x * 2 + 1] ?? " ", index = y * width + x;
      if (a === "#" && b === "#") cells[index] = CellKind.Wall;
      else if (a === "." && b === " ") cells[index] = CellKind.Pellet;
      else if (a === "O" && b === " ") cells[index] = CellKind.PowerPellet;
      else if ((a === "P" || a === "G") && directionChars.includes(b)) {
        cells[index] = a === "P" ? CellKind.Player : CellKind.Ghost;
        directions[index] = directionChars.indexOf(b);
      } else if (a !== " " || b !== " ") throw new Error(`Invalid cell at ${x + 1}, ${y + 1}`);
    }
  }
  return { width, height: lines.length, cells, directions };
}

function encode(width, height, cells, directions) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    let row = "";
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      switch (cells[index]) {
        case CellKind.Wall: row += "##"; break;
        case CellKind.Pellet: row += ". "; break;
        case CellKind.PowerPellet: row += "O "; break;
        case CellKind.Player: row += `P${directionChars[directions[index]]}`; break;
        case CellKind.Ghost: row += `G${directionChars[directions[index]]}`; break;
        default: row += "  ";
      }
    }
    rows.push(row);
  }
  return `${rows.join("\n")}\n`;
}

self.onmessage = (event) => {
  try {
    if (event.data.type === "decode") {
      const grid = decode(event.data.text);
      self.postMessage({ type: "decoded", width: grid.width, height: grid.height, cells: grid.cells.buffer, directions: grid.directions.buffer }, [grid.cells.buffer, grid.directions.buffer]);
    } else {
      self.postMessage({ type: "encoded", id: event.data.id, text: encode(event.data.width, event.data.height, new Uint8Array(event.data.cells), new Uint8Array(event.data.directions)) });
    }
  } catch (error) {
    self.postMessage({ type: "error", id: event.data.id, message: error instanceof Error ? error.message : "Invalid level" });
  }
};
