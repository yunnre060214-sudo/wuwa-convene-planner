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
    optimal: "逐抽动态最优",
  };

  function parseCurve(input) {
    const values = input.trim().split(/[\s,，、]+/);
    if (values.length !== 80) throw new Error("每条自定义曲线须填写 80 项。");
    const parsed = values.map((value, index) => {
      const match = /^(\d{1,3})(?:\.(\d{1,7}))?%?$/.exec(value);
      if (!match) throw new Error(`曲线第 ${index + 1} 项须为百分数，最多 7 位小数。`);
      const exact = Number(match[1]) * 10_000_000 + Number((match[2] ?? "").padEnd(7, "0"));
      if (exact > 1_000_000_000) throw new Error(`曲线第 ${index + 1} 项超出 100%。`);
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

  return { scale, curves, strategies, parseCurve, formatProbability };
})();
