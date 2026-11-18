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
  field("calculate").click();
  await wait(() => field("status").textContent === "计算完成");
  expect(field("probability").textContent === "100%", "Wrong joint feedback probability");
  expect(field("baseline-value").textContent === "0%", "Wrong joint no-feedback probability");
  expect(field("comparison-rows").children.length === 3, "Missing strategy comparison");

  document.querySelector('[name="target"][value="weapon"]').click();
  set("astrite", 0);
  expect(field("status").textContent.includes("重新计算"), "Edited settings should mark prior results stale");
  field("calculate").click();
  await wait(() => field("status").textContent === "计算完成");
  expect(field("probability").textContent === "0%", "Wrong empty-wallet probability");
  expect(field("result-label").textContent === "武器成功概率", "Wrong result mode");

  document.querySelector('[data-page="model"]').click();
  set("profile", "custom");
  field("calculate").click();
  expect(field("status").textContent.includes("80 项"), "Invalid custom curves were accepted");
  field("seed-custom").click();
  expect(field("custom-character").value.split(" ").length === 80, "Curve seed failed");
  return { joint: "100%", noFeedback: "0%", emptyWallet: "0%", strategyRows: 3, customValidation: true };
}

function smokeRenderer(contents) {
  return contents.executeJavaScript(`(${exerciseRenderer.toString()})()`);
}

module.exports = { smokeRenderer };
