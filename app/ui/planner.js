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
  bounds: "持有份数不清楚时，用较少和较多的返还算出一个范围。",
  fullFour: "所有四星角色已有至少 7 份。再抽到四星角色返 8 个余波珊瑚，四星武器返 3 个。",
  normal: "其他角色按普通数量返还。",
  maxed: "按可能拿到的最多珊瑚算。",
  detail: "按你填写的角色份数和卡池名单算。",
};
const profileLabels = { empirical: "参考玩家记录", hard: "只算第 80 抽保底", custom: "按填入的出率" };
const pages = {
  plan: ["抽取计划", "规划限定角色与武器的唤取目标，估算手头资源的成功概率。"],
  ownership: ["角色持有量", "填写已有角色与共鸣链，估算重复唤取能返还的珊瑚。"],
  model: ["计算设置", "查看逐抽五星出率，调整卡池的保底与返还规则。"],
};
document.documentElement.classList.toggle("mac", navigator.platform.startsWith("Mac"));
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
  const [title, description] = pages[id];
  $("page-title").textContent = title;
  $("page-description").textContent = description;
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
    const c = propertyInput("number", "characterWeight", role.characterWeight ?? 1, "角色池可抽情况", 1000);
    const w = propertyInput("number", "weaponWeight", role.weaponWeight ?? 1, "武器池可抽情况", 1000);
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
      if (validate && !input.validity.valid) throw new Error("请检查角色名称、已有份数和卡池栏里的数字。");
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

function readFourPool(prefix) {
  const roleID = `preset-${prefix}-roles`;
  const weaponID = `preset-${prefix}-weapons`;
  const fields = [$(roleID), $(weaponID)];
  if (fields.every((field) => field.value === "" && !field.validity.badInput)) return null;
  if (fields.some((field) => field.value === "")) {
    const pool = prefix === "c" ? "角色池" : "武器池";
    throw new Error(`${pool}的四星角色数和武器数请一起填，也可以都留空。`);
  }
  return { characters: number(roleID), weapons: number(weaponID) };
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
  const useFive = ownership === "detail" || ownership === "fullFour" && checked("preset-use-five");
  const fiveRoster = useFive ? readRoster("five", true) : [];
  if (useFive && fiveRoster.length === 0) throw new Error("请至少填写一位常驻五星角色。");
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
      wavebands: chain && checked("spend-wavebands") ? number("wavebands") : 0, buyCounts: checked("buy-counts"),
    },
    pools: [followPool("c", character || farm), followPool("w", weapon || farm)],
    ownership: {
      mode: ownership,
      four: ownership === "detail" ? readRoster("four", true) : [],
      five: fiveRoster,
      fourPools: ownership === "fullFour" ? [readFourPool("c"), readFourPool("w")] : [null, null],
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
  const shopEnabled = character && chain && checked("spend-wavebands");
  $("spend-wavebands").disabled = !character;
  show("shop-field", shopEnabled);
  show("shop-hint", !shopEnabled);
  $("shop-hint").textContent = !character ? "有角色目标时可用。" :
    chain ? "开启后可填写还能换几份。" : "开启后，角色目标会切换为共鸣链。";
  show("coral-shared", shopEnabled);
  $("coral-shared").textContent = checked("spend-afterglow") ? "两种用法共用余波珊瑚。先拥有角色，才能换频段。" : "先拥有角色，才能换频段。";
  show("compare-field", mode === "joint");
  for (const id of ["c4-label", "w4-label"]) {
    $(id).textContent = checked("five-resets-four") ? "距上次四星或五星" : "距上次四星";
  }
  const ownership = $("ownership-mode").value;
  const preset = ownership === "fullFour";
  const useFive = checked("preset-use-five");
  show("full-four-editor", preset);
  show("preset-five-default", !useFive);
  show("five-editor", ownership === "detail" || preset && useFive);
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
  if (series.length === 0) fragments.append(element("span", "填好角色池的 80 个出率后显示曲线。", "chart-empty"));
  chart.replaceChildren(fragments);
  const notes = {
    empirical: "参考公开的约 1,500 万抽记录。按这组数据，第 66 抽起更容易出五星，第 79 抽出率达到 100%。",
    hard: "第 1 到 79 抽都按 0.8%，第 80 抽必出。",
    custom: "图里显示角色池。武器池按下方填写的数字计算。",
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
    if (!Object.hasOwn(saved.values, "spend-wavebands") && saved.values["character-mode"] === "chain") {
      $("spend-wavebands").checked = Number($("wavebands").value) > 0 && Object.hasOwn(saved.values, "wavebands");
    }
    if (Number($("wavebands").value) < 1) $("wavebands").value = 1;
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
    notes.push(probability.upper === "0" ? "当前方案无法达标。" : "试算中成功的情况太少，暂时算不出余量。");
  }
  if (uncertainty === "bounds") notes.push("抽数按普通返还估算。");
  if (uncertainty === "fullFourRange") notes.push("卡池数量未填全，抽数按较少返还估算。");
  $("draw-status").textContent = notes.join("") || "余量只统计成功的情况。";

  const ranges = [];
  if (resources.total && resources.total.p10 !== resources.total.p90) {
    ranges.push(`含返还 ${drawCount(resources.total.p10)}–${drawCount(resources.total.p90)} 抽`);
  }
  if (resources.leftover && resources.leftover.p10 !== resources.leftover.p90) {
    ranges.push(`达标后剩 ${drawCount(resources.leftover.p10)}–${drawCount(resources.leftover.p90)} 抽`);
  }
  $("draw-spread").textContent = ranges.length ? `大约八成的情况为${ranges.join("、")}。` : "";

  const conditions = [];
  if (resources.meanWavebands > 0) {
    conditions.push(`达标时平均换了 ${drawCount(resources.meanWavebands)} 份频段。`);
  }
  if (resources.approximateOrder) {
    conditions.push("部分时候先抽哪池都说不准，抽数按试算用的抽法估计。");
  }
  conditions.push(`共试算 ${drawCount(resources.trials)} 次。`);
  $("draw-conditions").textContent = conditions.join("");
  show("draw-method", true);
}

function changed(event) {
  revision++;
  const id = event?.target?.id;
  if (id === "spend-wavebands" && checked("spend-wavebands")) $("character-mode").value = "chain";
  if (id === "character-mode" && $("character-mode").value !== "chain") $("spend-wavebands").checked = false;
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
    bar.setAttribute("aria-label", `${label}的保守成功率`);
    wrapper.append(bar);
  }
  return wrapper;
}

function display(result, config, mode, profile, current) {
  hasResult = true;
  const picked = result.rows.find((entry) => entry.strategy === config.strategy) ?? result.rows[0];
  const probability = formatProbability(picked.probability);
  for (const bound of ["lower", "upper"]) {
    const percent = 100 * Number(picked.probability[bound]) / Number(scale);
    $(`gauge-${bound}`).setAttribute("stroke-dasharray", `${percent} 100`);
  }
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
  if (result.uncertainty === "fullFourRange") notes.push("卡池里的四星数量未知，已考虑多返和少返两种情况。");
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
  status(`正在算「${strategies[progress.strategy]}」…`);
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
  ["c-up4", "w-up4", "farm", "spend-wavebands"].forEach((id) => { $(id).checked = false; });
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

const checkUpdate = $("check-update");
checkUpdate.addEventListener("click", async () => {
  checkUpdate.disabled = true;
  try {
    await window.convene?.checkUpdate();
  } catch {
    status("暂时无法检查更新。", true);
  } finally {
    checkUpdate.disabled = false;
    $("update-label").textContent = "检查更新";
  }
});
window.convene?.onUpdateStatus((value) => { $("update-label").textContent = value || "检查更新"; });
