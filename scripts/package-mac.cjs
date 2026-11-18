"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const pkg = require("../package.json");

async function run() {
  const architecture = "arm64";
  if (process.argv[2] && process.argv[2] !== architecture) {
    throw new Error("The macOS package targets Apple Silicon (arm64).");
  }
  const root = path.join(__dirname, "..");
  const output = path.join(root, "dist");
  const binary = path.join(root, "build", "engine-darwin-" + architecture, "convene");
  const swap = path.join(path.dirname(binary), "swap-app");
  const { packager } = await import("@electron/packager");
  execFileSync("bash", [path.join(__dirname, "build-engine.sh"), binary], {
    stdio: "inherit",
    env: {
      ...process.env,
      GOOS: "darwin",
      GOARCH: architecture,
    },
  });
  execFileSync("xcrun", ["clang", "-arch", architecture, "-mmacosx-version-min=13.0", "-O2", "-Wall", "-Wextra",
    "-o", swap, path.join(__dirname, "swap-app.c")], { stdio: "inherit" });
  const [target] = await packager({
    dir: root,
    out: output,
    platform: "darwin",
    arch: architecture,
    electronVersion: pkg.devDependencies.electron,
    name: "TidePlanner",
    appVersion: pkg.version,
    buildVersion: pkg.version,
    appBundleId: "io.github.yunnre060214-sudo.wuwa-convene-planner",
    appCategoryType: "public.app-category.utilities",
    icon: path.join(root, "app", "icon.icns"),
    extendInfo: { CFBundleDisplayName: "潮汐演算", LSMinimumSystemVersion: "13.0" },
    extraResource: [binary, swap],
    ignore: /^\/(?:engine|scripts|tests|docs|build|dist|node_modules|\.(?:git|github))(?:\/|$)/,
    overwrite: true,
    prune: false,
    asar: true,
    download: { cacheRoot: path.join(root, "build", "electron") },
  });
  const bundle = path.join(target, "TidePlanner.app");
  if (!fs.existsSync(path.join(bundle, "Contents", "Resources", "convene"))) {
    throw new Error("The packaged app is missing the solver");
  }
  if (process.platform === "darwin") {
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", bundle], { stdio: "inherit" });
    execFileSync("codesign", ["--verify", "--deep", "--strict", bundle], { stdio: "inherit" });
  }
  console.log(bundle);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
