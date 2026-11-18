"use strict";

const $ = (id) => document.getElementById(id);
const form = $("planner");
form.noValidate = true;
const storageKey = "tide-planner-1";
const { curves, strategies, scale, parseCurve, formatProbability, probabilityGrade, availableDraws } = TideModel;
const futureLabels = {
  character: "先抽角色", weapon: "先抽武器", waveband: "先换共鸣链",
};
const ownershipLabels = {
  bounds: "用普通和较多两种返还情况，估出成功率可能落在的范围。",
  normal: "假设其他角色重复时按普通数量返还。",
  maxed: "按重复角色可能返还的最多数量计算。",
  detail: "根据每个角色的持有份数处理返还。请补全两池名单和掉落权重。",
};
const profileLabels = { empirical: "参考社区实测", hard: "只算第 80 抽保底", custom: "自定义保底" };
const pageTitles = { plan: "抽取计划", ownership: "角色持有量", model: "计算设置" };
const appFields = Array.from(form.querySelectorAll("[id]")).filter((field) =>
  field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement
);
let revision = 0;
let running = false;
let hasResult = false;

function element(tag, text = "", classes = "") {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (classes) node.className = classes;
  return node;
}

function selectPage(id) {
  document.querySelectorAll(".page").forEach((page) => { page.hidden = page.id !== id; });
  document.querySelectorAll(".nav-button").forEach((button) => {
    const active = button.dataset.page === id;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  $("page-title").textContent = pageTitles[id];
  window.scrollTo(0, 0);
}

function show(id, visible) {
  $(id).hidden = !visible;
}

function number(id) {
  const field = $(id);
  const value = field.valueAsNumber;
  if (!Number.isSafeInteger(value) || !field.validity.valid) {
    const label = field.labels?.[0]?.firstChild?.textContent?.trim() || field.getAttribute("aria-label") || "数值";
    throw new Error(`请检查「${label}」，应为 ${field.min} 至 ${field.max} 的整数。`);
  }
  return value;
}

function checked(id) {
  return $(id).checked;
}

function target() {
  return form.elements.target.value;
}

function propertyInput(type, property, value, label, max) {
  const input = element("input");
  input.type = type;
  input.dataset.property = property;
  input.setAttribute("aria-label", label);
  if (type === "checkbox") {
    input.checked = Boolean(value);
  } else {
    input.value = value;
    input.required = true;
    if (type === "number") {
      input.min = "0";
      input.max = String(max);
    } else {
      input.maxLength = 40;
    }
  }
  return input;
}

function rosterRow(category, role = {}) {
  const row = element(category === "four" ? "tr" : "div", "", category === "five" ? "five-entry" : "");
  const name = propertyInput("text", "name", role.name ?? "", "角色名称");
  const owned = propertyInput("number", "owned", role.owned ?? 0, "已有份数", 7);
  const remove = element("button", "×", "remove-row");
  remove.type = "button";
  remove.setAttribute("aria-label", "移除此角色");
  remove.addEventListener("click", () => {
    row.remove();
    changed();
  });
  if (category === "five") {
    row.append(name, owned, remove);
  } else {
    const up = propertyInput("checkbox", "up", role.up, "属于角色池 UP 四星");
    const c = propertyInput("number", "characterWeight", role.characterWeight ?? 1, "角色池权重", 1000);
    const w = propertyInput("number", "weaponWeight", role.weaponWeight ?? 1, "武器池权重", 1000);
    c.disabled = up.checked;
    up.addEventListener("change", () => { c.disabled = up.checked; });
    [name, owned, up, c, w, remove].forEach((control) => {
      const cell = element("td");
      cell.append(control);
      row.append(cell);
    });
  }
  $(`${category}-roster`).append(row);
  return name;
}

function readRoster(category, validate = false) {
  const names = new Set();
  return Array.from($(`${category}-roster`).children, (row) => {
    const role = {};
    row.querySelectorAll("[data-property]").forEach((input) => {
      if (validate && !input.validity.valid) throw new Error("请填写完整、有效的角色名称、持有数和概率权重。");
      let value = input.value;
      if (input.type === "checkbox") value = input.checked;
      if (input.type === "number") value = Number(input.value);
      role[input.dataset.property] = value;
    });
    if (validate && (!role.name.trim() || names.has(role.name.trim()))) {
      throw new Error("同一张名单中的角色名称须非空且唯一。");
    }
    names.add(role.name.trim());
    return role;
  });
}

function readWallet() {
  return {
    astrite: number("astrite"), lunite: number("lunite"),
    tides: [number("radiant"), number("forging")],
    afterglow: number("afterglow"), oscillated: number("oscillated"),
    oscStock: [number("radiant-stock"), number("forging-stock")],
    spendAfterglow: checked("spend-afterglow"),
  };
}

function collect() {
  const mode = target();
  const character = mode !== "weapon";
  const weapon = mode !== "character";
  const chain = character && $("character-mode").value === "chain";
  const rank = weapon && $("weapon-mode").value === "rank";
  const farm = checked("farm");
  const profile = $("profile").value;
  const ownership = $("ownership-mode").value;
  const five = profile === "custom"
    ? [parseCurve($("custom-character").value), parseCurve($("custom-weapon").value)]
    : [curves[profile], curves[profile]];
  const followPool = (prefix, usesPool) => ({
    pity5: usesPool ? number(`${prefix}5`) : 0,
    pity4: usesPool ? number(`${prefix}4`) : 0,
    up5: usesPool && prefix === "c" && checked("c-up5"),
    up4: usesPool && checked(`${prefix}-up4`),
  });
  const held = chain ? Number($("character-owned").value) : 0;
  const copies = character || farm
    ? $("target-copies").value === "" ? held : number("target-copies")
    : 0;
  return {
    resources: readWallet(),
    goals: {
      character: character ? chain ? Number($("character-chain").value) : number("character-copies") : 0,
      weapon: weapon ? rank ? Number($("weapon-rank").value) : number("weapon-copies") : 0,
      heldCharacter: held, targetCopies: copies,
      heldWeapon: rank ? number("weapon-owned") : 0,
      characterChain: chain, weaponRank: rank,
      wavebands: chain ? number("wavebands") : 0, buyCounts: checked("buy-counts"),
    },
    pools: [followPool("c", character || farm), followPool("w", weapon || farm)],
    ownership: {
      mode: ownership,
      four: ownership === "detail" ? readRoster("four", true) : [],
      five: ownership === "detail" ? readRoster("five", true) : [],
      weaponWeights: ownership === "detail" ? [number("c-weapon-weight"), number("w-weapon-weight")] : [0, 0],
    },
    rules: { five, fourMode: $("four-mode").value, fiveResetsFour: checked("five-resets-four") },
    strategy: $("strategy").value,
    farm, compare: mode === "joint" && checked("compare"),
    baseline: checked("baseline"), stateBudget: Number($("state-budget").value),
  };
}

function sync() {
  const mode = target();
  const character = mode !== "weapon";
  const weapon = mode !== "character";
  const chain = $("character-mode").value === "chain";
  const rank = $("weapon-mode").value === "rank";
  const farm = checked("farm");
  show("character-goal", character || farm);
  show("weapon-goal", weapon);
  show("character-type-field", character);
  show("character-copy-field", character && !chain);
  show("character-chain-field", character && chain);
  show("character-owned-field", character && chain);
  show("target-copies-field", character || farm);
  show("weapon-copy-field", !rank);
  show("weapon-rank-field", rank);
  show("weapon-owned-field", rank);
  show("character-pool", character || farm);
  show("weapon-pool", weapon || farm);
  show("shop-field", character && chain);
  show("shop-hint", !character || !chain);
  show("coral-shared", character && chain);
  show("compare-field", mode === "joint");
  for (const id of ["c4-label", "w4-label"]) {
    $(id).textContent = checked("five-resets-four") ? "距上次四星或五星" : "距上次四星";
  }
  const ownership = $("ownership-mode").value;
  show("roster-editor", ownership === "detail");
  $("ownership-description").textContent = ownershipLabels[ownership];
  const profile = $("profile").value;
  show("custom-curves", profile === "custom");
  if (!hasResult) {
    $("result-label").textContent = ({ joint: "联合成功概率", character: "角色成功概率", weapon: "武器成功概率" })[mode];
    $("result-rule").textContent = profileLabels[profile];
  }
  try {
    const wallet = readWallet();
    const count = availableDraws(wallet, mode, farm && $("strategy").value === "optimal");
    $("draw-now").textContent = `${drawCount(count.total)} 抽`;
    $("draw-breakdown").textContent = `波纹 ${drawCount(count.tides)} 抽、星声与月相 ${drawCount(count.astrite)} 抽、残振珊瑚 ${drawCount(count.oscillated)} 抽、余波珊瑚 ${drawCount(count.afterglow)} 抽。`;
  } catch {
    $("draw-now").textContent = "—";
    $("draw-breakdown").textContent = "填好手头资源和兑换库存后显示。";
  }
}

function chart() {
  const profile = $("profile").value;
  const chart = $("curve-chart");
  let series = curves[profile];
  if (profile === "custom") {
    try { series = parseCurve($("custom-character").value); }
    catch { series = []; }
  }
  const fragments = document.createDocumentFragment();
  for (const [index, rate] of series.entries()) {
    const bar = element("progress");
    bar.max = 1_000_000_000;
    bar.value = rate;
    bar.title = `第 ${index + 1} 抽 · ${rate / 10_000_000}%`;
    bar.setAttribute("aria-hidden", "true");
    fragments.append(bar);
  }
  chart.replaceChildren(fragments);
  const notes = {
    empirical: "采用前三个版本约 1,500 万抽的公开分析。第 66、71、76 抽起分段上升，第 79 抽达到 100% 的拟合值。",
    hard: "第 1 至 79 抽使用 0.8%，第 80 抽使用 100%。此情景用于比较软保底的影响。",
    custom: "图中显示角色池曲线，武器池使用下方独立参数。",
  };
  $("curve-note").textContent = notes[profile];
}

function save() {
  const values = Object.fromEntries(appFields.map((field) =>
    [field.id, field.type === "checkbox" ? field.checked : field.value]
  ));
  try {
    localStorage.setItem(storageKey, JSON.stringify({ values, target: target(), four: readRoster("four"), five: readRoster("five") }));
  } catch {
    // The current session still works if local settings cannot be saved.
  }
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (!saved) return false;
    for (const field of appFields) {
      if (!Object.hasOwn(saved.values, field.id)) continue;
      if (field.type === "checkbox") field.checked = Boolean(saved.values[field.id]);
      else field.value = saved.values[field.id];
    }
    form.elements.target.value = saved.target;
    (saved.four ?? []).slice(0, 64).forEach((role) => rosterRow("four", role));
    (saved.five ?? []).slice(0, 32).forEach((role) => rosterRow("five", role));
    return true;
  } catch {
    return false;
  }
}

function status(text, error = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
}

function drawCount(value) {
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 1 });
}

function clearForecast() {
  $("draw-total").textContent = "—";
  $("draw-leftover").textContent = "—";
  show("draw-method", false);
  $("draw-status").textContent = hasResult ? "重新计算后更新返还和余量。" : "计算后显示返还和余量。";
}

function displayForecast(resources, probability, uncertainty) {
  const estimate = (value) => value ? `约 ${drawCount(value.mean)} 抽` : "—";
  $("draw-now").textContent = `${drawCount(resources.available)} 抽`;
  $("draw-total").textContent = estimate(resources.total);
  $("draw-leftover").textContent = estimate(resources.leftover);

  const notes = [];
  if (resources.totalLimited) notes.push("含返还总量超出估算范围。");
  if (resources.planLimited) notes.push("未能估算达标余量。");
  else if (!resources.leftover) {
    notes.push(probability.upper === "0" ? "当前方案无法达标。" : "模拟中达标的情况太少，暂未估算余量。");
  }
  if (uncertainty === "bounds") notes.push("抽数按普通返还估算。");
  $("draw-status").textContent = notes.join("") || "余量只统计成功的情况。";

  const ranges = [];
  if (resources.total && resources.total.p10 !== resources.total.p90) {
    ranges.push(`含返还 ${drawCount(resources.total.p10)}–${drawCount(resources.total.p90)} 抽`);
  }
  if (resources.leftover && resources.leftover.p10 !== resources.leftover.p90) {
    ranges.push(`达标后剩 ${drawCount(resources.leftover.p10)}–${drawCount(resources.leftover.p90)} 抽`);
  }
  $("draw-spread").textContent = ranges.length ? `中间约八成的模拟结果为${ranges.join("、")}。` : "";

  const conditions = [];
  if (resources.meanWavebands > 0) {
    conditions.push(`达标时平均换了 ${drawCount(resources.meanWavebands)} 份频段。`);
  }
  if (resources.approximateOrder) {
    conditions.push("部分步骤的最佳抽法仍不确定，抽数按应用能判断的抽法估算。");
  }
  conditions.push(`基于 ${drawCount(resources.trials)} 次模拟。`);
  $("draw-conditions").textContent = conditions.join("");
  show("draw-method", true);
}

function changed(event) {
  revision++;
  const id = event?.target?.id;
  sync();
  if (["profile", "custom-character"].includes(id)) chart();
  save();
  clearForecast();
  if (hasResult && !running) status("配置已变化，请重新计算。");
}

function row(label, probability, meter = false) {
  const wrapper = element("div", "", "comparison-item");
  wrapper.append(element("span", label), element("strong", formatProbability(probability, 4).text));
  if (meter) {
    const bar = element("meter");
    bar.min = 0;
    bar.max = 1;
    bar.value = Number(BigInt(probability.lower)) / Number(scale);
    bar.setAttribute("aria-label", `${label}的概率下界`);
    wrapper.append(bar);
  }
  return wrapper;
}

function display(result, config, mode, profile, current) {
  hasResult = true;
  const picked = result.rows.find((entry) => entry.strategy === config.strategy) ?? result.rows[0];
  const probability = formatProbability(picked.probability);
  $("probability").textContent = probability.text;
  $("probability").classList.toggle("range", probability.range);
  $("result-label").textContent = ({ joint: "联合成功概率", character: "角色成功概率", weapon: "武器成功概率" })[mode];
  $("result-rule").textContent = profileLabels[profile];
  const grade = probabilityGrade(picked.probability);
  const gradeLabel = $("luck-grade");
  gradeLabel.textContent = grade.label;
  gradeLabel.dataset.tone = grade.tone;
  gradeLabel.title = grade.detail ?? "";
  show("luck-grade", true);
  $("result-detail").textContent = strategies[picked.strategy];
  if (current) displayForecast(result.resources, picked.probability, result.uncertainty);
  else clearForecast();
  show("comparison", result.rows.length > 1 || Boolean(picked.baseline));
  $("comparison-title").textContent = result.rows.length > 1 ? "策略对比" : "回流影响";
  $("comparison-rows").replaceChildren(...result.rows.map((entry) => row(strategies[entry.strategy], entry.probability, true)));
  show("baseline-row", Boolean(picked.baseline));
  $("baseline-value").textContent = picked.baseline ? formatProbability(picked.baseline, 4).text : "";
  const actions = picked.strategy === "optimal" ? picked.actions ?? [] : [];
  const best = actions.find((entry) => actions.length > 1 && actions.every((other) =>
    entry === other || BigInt(entry.probability.lower) > BigInt(other.probability.upper)
  ));
  show("advice", actions.length > 1);
  $("advice-note").textContent = best
    ? futureLabels[best.id]
    : "目前看不出哪一步更有把握。";
  $("advice-rows").replaceChildren(...actions.map((entry) => row(futureLabels[entry.id], entry.probability)));
  const notes = [];
  if (grade.detail) notes.push(grade.detail + "。");
  if (result.uncertainty === "bounds") notes.push("持有量未知，重复返还有差别。");
  if (result.rows.some((entry) => entry.incomplete)) notes.push("提高计算精细度，有机会缩小概率范围。");
  $("uncertainty").textContent = notes.join("");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (running) return;
  if (!window.convene) {
    status("请在 macOS 应用中运行计算。", true);
    return;
  }
  let config;
  try { config = collect(); }
  catch (error) {
    status(error.message, true);
    return;
  }
  const started = revision;
  const mode = target();
  const profile = $("profile").value;
  running = true;
  $("calculate").disabled = true;
  show("cancel", true);
  status("正在计算成功率…");
  try {
    const outcome = await window.convene.calculate(config);
    if (outcome.cancelled) status("计算已停止。");
    else if (outcome.error) status(outcome.error, true);
    else {
      const current = started === revision;
      display(outcome.result, config, mode, profile, current);
      status(current ? "计算完成" : "设置有改动，请重新计算。");
    }
  } catch (error) {
    status(`计算失败：${error.message}`, true);
  } finally {
    running = false;
    $("calculate").disabled = false;
    show("cancel", false);
    $("cancel").disabled = false;
  }
});

$("cancel").addEventListener("click", () => {
  $("cancel").disabled = true;
  window.convene?.cancel();
  status("正在停止计算…");
});
window.convene?.onProgress((progress) => {
  if (!running || $("cancel").disabled) return;
  if (progress.forecast) {
    status("正在估算返还和抽数…");
    return;
  }
  const count = progress.states.toLocaleString("zh-CN");
  status(`正在计算${strategies[progress.strategy]} · 已看过 ${count} 种情况`);
});
form.addEventListener("input", changed);
document.querySelectorAll(".nav-button").forEach((button) => {
  button.addEventListener("click", () => selectPage(button.dataset.page));
});
document.querySelectorAll("[data-add]").forEach((button) => {
  button.addEventListener("click", () => {
    const category = button.dataset.add;
    if ($(`${category}-roster`).children.length >= (category === "four" ? 64 : 32)) return;
    rosterRow(category).focus();
    changed();
  });
});
$("seed-custom").addEventListener("click", () => {
  const template = curves.empirical.map((p) => p / 10_000_000).join(" ");
  $("custom-character").value = template;
  $("custom-weapon").value = template;
  chart();
  changed();
});
$("example").addEventListener("click", () => {
  form.elements.target.value = "joint";
  const fields = {
    "character-mode": "copies", "character-copies": "1", "target-copies": "0",
    "weapon-mode": "copies", "weapon-copies": "1", astrite: "2560", lunite: "0",
    radiant: "4", forging: "2", afterglow: "16", oscillated: "80",
    "radiant-stock": "2", "forging-stock": "2", c5: "68", c4: "5", w5: "62", w4: "4",
    strategy: "optimal", profile: "empirical", "ownership-mode": "bounds", "state-budget": "800000",
  };
  for (const [id, value] of Object.entries(fields)) $(id).value = value;
  ["c-up5", "compare", "baseline", "spend-afterglow", "five-resets-four"].forEach((id) => { $(id).checked = true; });
  ["c-up4", "w-up4", "farm"].forEach((id) => { $(id).checked = false; });
  selectPage("plan");
  chart();
  changed();
  status("示例已载入。");
});

for (let i = 0; i <= 7; i++) {
  const label = i === 0 ? "未拥有" : i === 1 ? "本体 · 0 链" : `${i - 1} 链（${i} 份）`;
  $("character-owned").add(new Option(label, i));
  if (i > 0) $("character-chain").add(new Option(label, i));
}
for (let i = 1; i <= 5; i++) $("weapon-rank").add(new Option(`${i} 阶（${i} 份）`, i));
if (!load()) {
  ["卡卡罗", "鉴心", "维里奈", "凌阳", "安可"].forEach((name) => rosterRow("five", { name }));
  ["UP 四星 1", "UP 四星 2", "UP 四星 3"].forEach((name) => rosterRow("four", { name, up: true }));
  $("c-weapon-weight").value = 0;
  $("w-weapon-weight").value = 0;
  $("state-budget").value = 3_000_000;
}
sync();
chart();
