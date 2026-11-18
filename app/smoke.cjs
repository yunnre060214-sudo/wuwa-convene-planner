"use strict";

async function exerciseRenderer() {
  const field = (id) => {
    const element = document.getElementById(id);
    if (!element) throw new Error("Missing field " + id);
    return element;
  };
  const set = (id, value) => {
    const input = field(id);
    if (input.type === "checkbox") input.checked = value;
    else input.value = String(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const expect = (condition, detail) => {
    if (!condition) throw new Error(detail);
  };
  const wait = (read) => new Promise((resolve, reject) => {
    const deadline = performance.now() + 20_000;
    const timer = setInterval(() => {
      if (field("status").classList.contains("error")) {
        clearInterval(timer);
        reject(new Error(field("status").textContent));
      } else if (read()) {
        clearInterval(timer);
        resolve();
      } else if (performance.now() > deadline) {
        clearInterval(timer);
        reject(new Error("Renderer calculation timed out: " + field("status").textContent));
      }
    }, 25);
  });

  expect(typeof window.convene?.calculate === "function", "Renderer bridge unavailable");
  set("profile", "hard");
  set("state-budget", 100_000);
  set("astrite", 160);
  set("c5", 79);
  set("w5", 79);
  set("c-up5", true);
  expect(field("draw-now").textContent === "1 抽", "Wrong live starting stock");
  field("calculate").click();
  await wait(() => field("status").textContent === "计算完成");
  expect(field("probability").textContent === "100%", "Wrong joint feedback probability");
  expect(field("baseline-value").textContent === "0%", "Wrong joint no-feedback probability");
  expect(field("comparison-rows").children.length === 3, "Missing strategy comparison");
  expect(field("luck-grade").textContent === "稳稳拿下", "Missing certainty grade");
  expect(field("draw-leftover").textContent === "约 2 抽", "Wrong joint leftover");
  expect(/^约 [0-9]+/.test(field("draw-total").textContent), "Missing refund-adjusted draw total");

  document.querySelector('[name="target"][value="weapon"]').click();
  set("astrite", 0);
  expect(field("status").textContent.includes("重新计算"), "Edited settings should mark prior results stale");
  expect(field("draw-now").textContent === "0 抽", "Live wallet did not refresh");
  expect(field("draw-leftover").textContent === "—", "Stale leftover should be cleared");
  field("calculate").click();
  await wait(() => field("status").textContent === "计算完成");
  expect(field("probability").textContent === "0%", "Wrong empty-wallet probability");
  expect(field("result-label").textContent === "武器成功概率", "Wrong result mode");
  expect(field("draw-leftover").textContent === "—", "An impossible plan should have no leftover estimate");

  document.querySelector('[name="target"][value="character"]').click();
  set("character-mode", "chain");
  set("character-owned", 1);
  set("character-chain", 2);
  set("wavebands", 1);
  set("afterglow", 360);
  expect(!field("shop-field").hidden, "Chain exchange should be visible");
  expect(field("draw-now").textContent === "45 抽", "Wrong red coral conversion");
  set("spend-afterglow", false);
  expect(field("draw-now").textContent === "0 抽", "Reserved coral should leave the draw budget");
  field("calculate").click();
  await wait(() => field("status").textContent === "计算完成");
  expect(field("probability").textContent === "100%", "The independent waveband option should still work");
  expect(field("draw-leftover").textContent === "约 0 抽", "Wrong waveband-only leftover");
  expect(field("draw-conditions").textContent.includes("换了 1 份频段"), "Missing waveband use");

  document.querySelector('[data-page="ownership"]').click();
  set("ownership-mode", "fullFour");
  expect(!field("full-four-editor").hidden && field("roster-editor").hidden, "Preset should replace the individual four-star inputs");
  expect(field("five-editor").hidden, "Preset should work without a five-star roster");
  set("preset-use-five", true);
  expect(!field("five-editor").hidden, "Five-star roster should be available on request");
  set("preset-use-five", false);
  set("character-mode", "copies");
  set("afterglow", 0);
  set("radiant", 1);
  set("spend-afterglow", true);
  set("c5", 78);
  set("c4", 9);
  field("calculate").click();
  await wait(() => field("status").textContent === "计算完成");
  expect(field("probability").textContent.endsWith("–100%"), "Unknown pool mix should show a range");
  expect(field("uncertainty").textContent.includes("四星数量未知"), "Missing preset range explanation");

  set("preset-c-roles", 12);
  field("calculate").click();
  expect(field("status").textContent.includes("请一起填"), "Incomplete pool totals should be explained");
  set("preset-c-weapons", 15);
  field("calculate").click();
  await wait(() => field("status").textContent === "计算完成");
  expect(field("probability").textContent === "69%", "Incorrect chance with known pool totals");
  expect(!field("uncertainty").textContent.includes("四星数量未知"), "The unplayed empty pool should not widen the result");
  const saved = JSON.parse(localStorage.getItem("tide-planner-1")).values;
  expect(saved["ownership-mode"] === "fullFour" && saved["preset-c-roles"] === "12", "Preset and totals should be saved");

  document.querySelector('[data-page="model"]').click();
  set("profile", "custom");
  field("calculate").click();
  expect(field("status").textContent.includes("80 个"), "Invalid custom curves were accepted");
  field("seed-custom").click();
  expect(field("custom-character").value.split(" ").length === 80, "Curve seed failed");
  return {
    joint: "100%", noFeedback: "0%", emptyWallet: "0%", strategyRows: 3,
    drawEstimates: true, coralChoice: true, probabilityGrade: true, fullFourPreset: true, customValidation: true,
  };
}

function smokeRenderer(contents) {
  return contents.executeJavaScript(`(${exerciseRenderer.toString()})()`);
}

module.exports = { smokeRenderer };
