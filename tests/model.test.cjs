"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const js = fs.readFileSync(path.join(__dirname, "../app/ui/model.js"), "utf8");
const model = vm.runInNewContext(js + "\nTideModel");

test("empirical intervals respect the selected source", () => {
  assert.equal(model.curves.empirical.length, 80);
  const indices = [1, 65, 66, 70, 71, 75, 76, 78, 79, 80];
  const rates = [0.8, 0.8, 4.8, 20.8, 28.8, 60.8, 70.8, 90.8, 100, 100];
  for (const [index, pull] of indices.entries()) {
    assert.equal(model.curves.empirical[pull - 1], rates[index] * 10_000_000);
  }
  assert.equal(model.curves.hard[78], 8_000_000);
});

test("custom percentages round trip exactly", () => {
  const values = Array(80).fill("0.0000001");
  values[79] = "100";
  const result = model.parseCurve(values.join("，"));
  assert.equal(result[0], 1);
  assert.equal(result[79], 1_000_000_000);
  assert.throws(() => model.parseCurve("0.8 100"), /80/);
  values[0] = "100.0000001";
  assert.throws(() => model.parseCurve(values.join(" ")), /超出/);
  values[0] = "0.00000001";
  assert.throws(() => model.parseCurve(values.join(" ")), /7 位/);
});

test("interval display rounds outward and avoids false certainty", () => {
  assert.equal(model.formatProbability({ lower: "0", upper: "0" }).text, "0%");
  assert.equal(model.formatProbability({ lower: "1", upper: "2" }).text, "<0.001%");
  assert.equal(model.formatProbability({
    lower: String(model.scale - 5n), upper: String(model.scale),
  }).text, ">99.999%");
  assert.equal(model.formatProbability({
    lower: String(model.scale / 3n), upper: String(model.scale / 2n + 1n),
  }).text, "33.333%–50.001%");
});

test("draw stock shares currency, respects the selected pools and keeps wavebands separate", () => {
  const wallet = {
    astrite: 159, lunite: 1, tides: [3, 9], afterglow: 18, oscillated: 140,
    oscStock: [1, 2], spendAfterglow: true,
  };
  assert.equal(model.availableDraws(wallet, "joint", false).total, 17);
  assert.equal(model.availableDraws(wallet, "character", false).total, 7);
  assert.equal(model.availableDraws(wallet, "character", true).total, 16);
  assert.equal(model.availableDraws({ ...wallet, spendAfterglow: false }, "character", false).total, 5);
});

test("probability grades respect thresholds and display uncertainty", () => {
  const units = (percent) => String(BigInt(percent) * model.scale / 100n);
  const grade = (lo, hi = lo) => model.probabilityGrade({ lower: units(lo), upper: units(hi) });
  assert.equal(grade(0).label, "当前方案无法达标");
  assert.equal(grade(1).label, "梦里什么都有");
  assert.equal(grade(20).label, "欧皇附体才有戏");
  assert.equal(grade(42).label, "还得拼手气");
  assert.equal(grade(50).label, "有戏");
  assert.equal(grade(75).label, "胜算挺大");
  assert.equal(grade(99).label, "基本稳了");
  assert.equal(grade(100).label, "稳稳拿下");
  assert.equal(grade(17, 20).label, "欧皇附体才有戏");
  assert.equal(grade(35, 95).label, "概率跨档");
  assert.equal(grade(99, 100).label, "基本稳了");
  assert.equal(model.probabilityGrade({
    lower: String(model.scale / 2n - 1n), upper: String(model.scale / 2n + 1n),
  }).label, "有戏");
});
