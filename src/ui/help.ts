import type { Scene } from "../world/game.ts";

export const HELP_KEYS = [
  ["ARROWS / HJKL", "MOVE ON MAP"],
  ["ENTER", "OPEN ZONE"],
  ["ESC", "BACK / CLOSE HELP"],
  ["1-6", "JUMP TO ZONE"],
  ["B", "ART / TABLE"],
  ["PGUP / PGDN", "CHANGE TABLE PAGE"],
  ["P", "PAUSE / RESUME METRICS"],
  ["?", "SHOW / HIDE HELP"],
  ["R", "TOGGLE RENDERER"],
  ["Q", "QUIT"],
] as const;

export const HELP_METAPHOR: Record<Scene, string> = {
  overworld: "EACH TILE SHOWS A DIFFERENT SYSTEM METRIC",
  cpu: "TALLER TOWERS MEAN BUSIER CORES",
  mem: "TANK LAYERS SHOW HOW RAM IS USED",
  net: "MORE PACKET STREAKS MEAN MORE TRAFFIC",
  disk: "ORE CARTS READ, STONE CARTS WRITE",
  proc: "BUSIER PROCESSES HOP FASTER",
  power: "MORE WATTS SPIN THE TURBINES FASTER",
};
