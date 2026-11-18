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
