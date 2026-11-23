import { expect, test } from "bun:test";
import { supervise, type PowermetricsHandle } from "../src/collectors/powermetrics-process.ts";
import { powermetricsArgs } from "../src/collectors/powermetrics.ts";
import { nopasswdCovers, sudoersLine } from "../src/core/privilege.ts";
import { fitByPriority } from "../src/world/common.ts";

const ARGS = powermetricsArgs().join(" ");

test("sudoersLine pins the exact command and escapes sudoers metacharacters", () => {
  const line = sudoersLine("alice");
  expect(line.startsWith("alice ALL=(root) NOPASSWD: /usr/bin/powermetrics -f plist -i 1000 --samplers cpu_power\\,")).toBe(true);
  expect(line).not.toContain("-o");
  expect(line).not.toContain("*");
});

test("nopasswdCovers recognizes rules that let our powermetrics run without a password", () => {
  const listing = (rule: string) => `User alice may run the following commands on mac:\n    (ALL) ALL\n    ${rule}\n`;
  // our own rule, as sudo -l may print it escaped or not
  expect(nopasswdCovers(listing(sudoersLine("alice").replace(/^alice ALL=/, "")))).toBe(true);
  expect(nopasswdCovers(listing(`(root) NOPASSWD: /usr/bin/powermetrics ${ARGS}`))).toBe(true);
  expect(nopasswdCovers(listing("(root) NOPASSWD: /usr/bin/powermetrics"))).toBe(true);
  expect(nopasswdCovers(listing("(ALL : ALL) NOPASSWD: ALL"))).toBe(true);
  expect(nopasswdCovers(listing("(root) NOPASSWD: /usr/bin/true, /usr/bin/powermetrics"))).toBe(true);
  expect(nopasswdCovers(listing("(root) NOPASSWD: SETENV: /usr/bin/powermetrics"))).toBe(true);
  // not enough
  expect(nopasswdCovers(listing("(ALL) ALL"))).toBe(false);
  expect(nopasswdCovers(listing("(root) NOPASSWD: /usr/bin/powermetrics -i 500"))).toBe(false);
  expect(nopasswdCovers(listing(`(root) NOPASSWD: /usr/bin/true, /usr/bin/powermetrics ${ARGS}`))).toBe(true);
  expect(nopasswdCovers(listing(`(root) NOPASSWD: /usr/bin/powermetrics ${ARGS} -o /etc/x`))).toBe(false);
  expect(nopasswdCovers(listing("(nobody) NOPASSWD: /usr/bin/powermetrics"))).toBe(false);
  expect(nopasswdCovers(listing("(root) NOPASSWD: /usr/bin/true"))).toBe(false);
  expect(nopasswdCovers("")).toBe(false);
});

function fakeChild(): PowermetricsHandle & { exit(code: number): void; stopped: boolean } {
  let resolve!: (code: number) => void;
  const exited = new Promise<number>((r) => { resolve = r; });
  const child = { exited, stopped: false, exit: (c: number) => resolve(c), stop: () => { child.stopped = true; resolve(143); } };
  return child;
}
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("supervise restarts powermetrics with backoff and stops cleanly", async () => {
  const children: ReturnType<typeof fakeChild>[] = [];
  const statuses: string[] = [];
  const sup = supervise({
    start: () => { const c = fakeChild(); children.push(c); return c; },
    onStatus: (s) => statuses.push(s),
    delaysMs: [5, 20],
    healthyMs: 10_000,
  });
  expect(children.length).toBe(1);
  children[0]!.exit(1);
  await tick(12);
  expect(children.length).toBe(2); // first retry after 5 ms
  children[1]!.exit(1);
  await tick(10);
  expect(children.length).toBe(2); // second retry waits 20 ms
  await tick(20);
  expect(children.length).toBe(3);
  expect(statuses[0]).toBe("exited (code 1), retrying in 0s");
  sup.stop();
  expect(children[2]!.stopped).toBe(true);
  await tick(30);
  expect(children.length).toBe(3); // no restart after stop
});

test("fitByPriority drops the least important items first and keeps order", () => {
  const items = [{ n: "brand", pri: 9 }, { n: "cpu", pri: 0 }, { n: "mem", pri: 2 }, { n: "up", pri: 8 }];
  const w = () => 10;
  expect(fitByPriority(items, 40, w).map((i) => i.n)).toEqual(["brand", "cpu", "mem", "up"]);
  expect(fitByPriority(items, 30, w).map((i) => i.n)).toEqual(["cpu", "mem", "up"]);
  expect(fitByPriority(items, 20, w).map((i) => i.n)).toEqual(["cpu", "mem"]);
});
