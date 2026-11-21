"use strict";

const TideModel = (() => {
  const scale = 1n << 62n;
  const curves = {
    hard: Array.from({ length: 80 }, (_, i) => i === 79 ? 1_000_000_000 : 8_000_000),
    empirical: Array.from({ length: 80 }, (_, i) => {
      if (i < 65) return 8_000_000;
      if (i < 70) return 8_000_000 + (i - 64) * 40_000_000;
      if (i < 75) return 208_000_000 + (i - 69) * 80_000_000;
      if (i < 78) return 608_000_000 + (i - 74) * 100_000_000;
      return 1_000_000_000;
    }),
  };
  const strategies = {
    characterFirst: "角色优先",
    weaponFirst: "武器优先",
    optimal: "看情况切换",
  };

  function parseCurve(input) {
    const values = input.trim().split(/[\s,，、]+/);
    if (values.length !== 80) throw new Error("每个卡池请填 80 个出率。");
    const parsed = values.map((value, index) => {
      const match = /^(\d{1,3})(?:\.(\d{1,7}))?%?$/.exec(value);
      if (!match) throw new Error(`第 ${index + 1} 抽请填百分数，最多 7 位小数。`);
      const exact = Number(match[1]) * 10_000_000 + Number((match[2] ?? "").padEnd(7, "0"));
      if (exact > 1_000_000_000) throw new Error(`第 ${index + 1} 抽的出率超出 100%。`);
      return exact;
    });
    if (parsed.at(-1) !== 1_000_000_000) throw new Error("第 80 项必须是 100%。");
    return parsed;
  }

  function formatProbability(probability, digits = 3) {
    const lower = BigInt(probability.lower);
    const upper = BigInt(probability.upper);
    const decimal = 10n ** BigInt(digits);
    const factor = 100n * decimal;
    const scalar = (n) => {
      const whole = n / decimal;
      const frac = String(n % decimal).padStart(digits, "0").replace(/0+$/, "");
      return `${whole}${frac ? "." + frac : ""}%`;
    };
    if (lower === upper && lower === 0n) return { text: "0%", range: false };
    if (lower === upper && lower === scale) return { text: "100%", range: false };
    if (upper * factor < scale) return { text: `<${scalar(1n)}`, range: false };
    if ((scale - lower) * factor < scale) return { text: `>${scalar(factor - 1n)}`, range: false };
    const lo = lower * factor / scale;
    const hi = (upper * factor + scale - 1n) / scale;
    if ((upper - lower) * factor < scale / 10n) {
      const midpoint = ((lower + upper) * factor + scale) / (2n * scale);
      return { text: scalar(midpoint), range: false };
    }
    return { text: `${scalar(lo)}–${scalar(hi)}`, range: true };
  }

  const grades = [
    { below: 5n, label: "概率极低", tone: "low" },
    { below: 25n, label: "概率低", tone: "low" },
    { below: 50n, label: "概率偏低", tone: "warm" },
    { below: 75n, label: "概率偏高", tone: "warm" },
    { below: 90n, label: "概率高", tone: "good" },
    { below: 101n, label: "概率极高", tone: "good" },
  ];

  function probabilityGrade(probability) {
    const lower = BigInt(probability.lower);
    const upper = BigInt(probability.upper);
    if (upper === 0n) return { label: "当前方案无法达标", tone: "low" };
    if (lower === scale) return { label: "确定达标", tone: "good" };
    const gradeAt = (value) => grades.find(({ below }) => value * 100n < below * scale);
    if ((upper - lower) * 10_000_000n < scale) return gradeAt((lower + upper) / 2n);
    const first = gradeAt(lower);
    const last = gradeAt(upper);
    return first === last ? first : {
      label: "概率跨档",
      tone: "neutral",
      detail: `从「${first.label}」到「${last.label}」`,
    };
  }

  function availableDraws(resources, mode, useSpare) {
    const selected = [mode !== "weapon", mode !== "character"];
    const astrite = Math.floor((resources.astrite + resources.lunite) / 160);
    const tides = resources.tides.reduce((sum, count, pool) => sum + (selected[pool] || useSpare ? count : 0), 0);
    const stock = resources.oscStock.reduce((sum, count, pool) => sum + (selected[pool] ? count : 0), 0);
    const oscillated = Math.min(Math.floor(resources.oscillated / 70), stock);
    const afterglow = resources.spendAfterglow ? Math.floor(resources.afterglow / 8) : 0;
    return { astrite, tides, oscillated, afterglow, total: astrite + tides + oscillated + afterglow };
  }

  return { scale, curves, strategies, parseCurve, formatProbability, probabilityGrade, availableDraws };
})();
