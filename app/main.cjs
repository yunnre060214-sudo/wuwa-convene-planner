"use strict";

const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const path = require("node:path");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const fs = require("node:fs/promises");
const { releases, checkForUpdate, installedBundle, prepareUpdate, applyUpdate, removeBackup } = require("./updater.cjs");

const allowedLinks = new Set([
  "https://wutheringwaves.kurogames.com/en/main/news/detail/758",
  "https://www.bilibili.com/opus/936615544201674759",
  "https://github.com/yunnre060214-sudo/wuwa-convene-planner/blob/main/docs/model.md",
  releases,
]);
const smoke = process.argv.includes("--smoke-test");
let window;
let running;
let updating = false;

function enginePath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "convene")
    : path.join(__dirname, "..", "build", "engine", "convene");
}

function authorized(event) {
  return window && !window.isDestroyed() && event.sender === window.webContents;
}

function calculate(event, config) {
  if (!authorized(event)) throw new Error("无效的计算请求");
  if (running) return { error: "已有计算正在运行" };
  if (updating) return { error: "请先结束更新，再开始计算。" };
  const input = JSON.stringify(config);
  if (!input || input.length > 150_000) return { error: "计算配置超出大小限制" };

  return new Promise((resolve) => {
    const child = spawn(enginePath(), { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const run = { child, cancelled: false };
    running = run;
    let outcome;
    let diagnostics = "";
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      try {
        const message = JSON.parse(line);
        if (message.progress && !run.cancelled && authorized(event)) {
          event.sender.send("solver:progress", message.progress);
        }
        if (message.result) outcome = { result: message.result };
        if (message.error) outcome = { error: message.error };
      } catch {
        outcome = { error: "概率引擎返回了无法识别的数据" };
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (diagnostics.length < 4096) diagnostics += chunk;
    });
    child.on("error", (error) => {
      outcome = { error: `无法启动概率引擎（${error.code ?? "启动失败"}）` };
    });
    child.stdin.on("error", () => {
      // The close or error handler reports a failed launch.
    });
    child.on("close", (code, signal) => {
      if (running === run) running = null;
      if (run.cancelled) {
        resolve({ cancelled: true });
      } else if (outcome) {
        resolve(outcome);
      } else {
        if (diagnostics) console.error(diagnostics.slice(0, 4096));
        resolve({ error: `概率引擎结束，未返回结果（${signal ?? code}）` });
      }
    });
    child.stdin.end(input);
  });
}

function stop() {
  if (running) {
    running.cancelled = true;
    running.child.kill();
  }
}

async function updateFromMenu(event) {
  if (!authorized(event) || event.senderFrame !== event.sender.mainFrame || updating) return;
  if (running) {
    await dialog.showMessageBox(window, { message: "请等本次计算结束，再检查更新。", buttons: ["好"] });
    return;
  }
  if (!app.isPackaged || process.platform !== "darwin" || smoke) {
    await dialog.showMessageBox(window, { message: "请在正式安装的 macOS 版里检查更新。", buttons: ["好"] });
    return;
  }

  updating = true;
  const report = (status) => {
    if (authorized(event)) event.sender.send("update:status", status);
  };
  let prepared;
  let applied = false;
  try {
    report("正在检查…");
    const current = app.getVersion();
    const update = await checkForUpdate(fetch, current);
    if (!authorized(event)) return;
    if (!update) {
      await dialog.showMessageBox(window, { message: `v${current} 已是最新版本。`, buttons: ["好"] });
      return;
    }
    const { response } = await dialog.showMessageBox(window, {
      message: `发现新版 v${update.version}`,
      detail: `约 ${Math.round(update.size / 1024 ** 2)} MB。安装后应用会重新打开，并读取本机保存的输入。`,
      buttons: ["下载并安装", "打开发布页", "取消"],
      defaultId: 0,
      cancelId: 2,
    });
    if (response === 1) await shell.openExternal(releases);
    if (response !== 0 || !authorized(event)) return;

    const executable = await fs.realpath(process.execPath);
    const bundle = installedBundle(executable);
    report("正在下载…");
    prepared = await prepareUpdate({
      fetcher: fetch, update, bundle,
      progress: (percent) => report(percent === null ? "正在校验…" : `正在下载 ${percent}%`),
    });
    if (!authorized(event)) return;
    report("正在安装…");
    await applyUpdate({ bundle, staged: prepared.staged, current, helper: path.join(process.resourcesPath, "swap-app") });
    applied = true;
    app.relaunch({ execPath: executable, args: [`--update-backup=${path.basename(prepared.directory)}`] });
    app.quit();
  } catch (error) {
    if (!authorized(event)) return;
    const { response } = await dialog.showMessageBox(window, {
      type: "warning",
      message: "暂时无法更新",
      detail: error.cmd ? "macOS 无法替换应用。可以从发布页下载新版，再手动替换。" : error.message,
      buttons: ["打开发布页", "关闭"],
      defaultId: 1,
      cancelId: 1,
    });
    if (response === 0) await shell.openExternal(releases);
  } finally {
    if (prepared && !applied) await fs.rm(prepared.directory, { recursive: true, force: true }).catch(console.error);
    updating = false;
    if (!applied) report("");
  }
}

function createWindow() {
  window = new BrowserWindow({
    width: 1270,
    height: 880,
    minWidth: 870,
    minHeight: 650,
    title: "潮汐演算",
    backgroundColor: "#f6f5f0",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: !smoke,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (allowedLinks.has(url)) void shell.openExternal(url).catch(console.error);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  if (!smoke) window.once("ready-to-show", () => window?.show());
  window.on("closed", () => {
    stop();
    window = null;
  });
  return window.loadFile(path.join(__dirname, "ui", "index.html"));
}

app.setName("潮汐演算");
if (smoke) {
  app.setPath("userData", path.join(app.getPath("temp"), `tide-planner-smoke-${process.pid}`));
  app.disableHardwareAcceleration();
}
const primaryInstance = smoke || app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
ipcMain.handle("solver:calculate", calculate);
ipcMain.handle("update:check", updateFromMenu);
ipcMain.on("solver:cancel", (event) => {
  if (authorized(event)) stop();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", stop);
app.whenReady().then(async () => {
  if (!primaryInstance) return;
  await createWindow();
  if (smoke) {
    window.webContents.on("console-message", (entry) => {
      if (entry.level === "error") console.error(entry.message);
    });
    const { smokeRenderer } = require("./smoke.cjs");
    const result = await smokeRenderer(window.webContents);
    console.log(JSON.stringify({ smoke: "passed", ...result }));
    app.exit(0);
    return;
  }
  const backup = process.argv.find(arg => arg.startsWith("--update-backup="));
  if (backup && app.isPackaged && process.platform === "darwin") {
    void fs.realpath(process.execPath).then(executable => removeBackup(executable, backup.slice("--update-backup=".length), app.getVersion())).catch(console.error);
  }
  app.on("second-instance", () => {
    if (!window) return void createWindow().catch(console.error);
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
  app.on("activate", () => {
    if (!window) void createWindow().catch(console.error);
  });
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
