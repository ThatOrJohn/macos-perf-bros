/**
 * Measures powermetrics sample parse cost (XML → plist → reading).
 * Usage: bun run scripts/bench-parse.ts [fixture.plist]
 */
import { NulSplitter, parsePlist } from "../src/collectors/plist.ts";
import { toReading } from "../src/collectors/powermetrics.ts";

const path = process.argv[2] ?? "fixtures/raw/apple-m1_macos-27.0.1/powermetrics/idle-all.plist";
const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
const records = new NulSplitter().push(bytes);

const ITER = 200;
const time = (fn: () => void) => {
  for (let i = 0; i < 20; i++) fn(); // warm up
  const t0 = performance.now();
  for (let i = 0; i < ITER; i++) fn();
  return (performance.now() - t0) / ITER;
};

const rec = records[0]!;
const split = time(() => new NulSplitter().push(bytes));
const xml = time(() => parsePlist(rec));
const plist = parsePlist(rec);
const map = time(() => toReading(plist));

const kb = (rec.length / 1024).toFixed(0);
console.log(`${path}\n  ${records.length} samples, ~${kb} KB XML each`);
console.log(`  split+decode whole file : ${(split / records.length).toFixed(2)} ms / sample`);
console.log(`  parsePlist              : ${xml.toFixed(2)} ms / sample`);
console.log(`  toReading               : ${map.toFixed(3)} ms / sample`);
console.log(`  total ≈ ${(split / records.length + xml + map).toFixed(2)} ms per 1 s tick`);
