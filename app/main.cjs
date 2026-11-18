"use strict";

const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");
const { spawn } = require("node:child_process");
const readline = require("node:readline");

const allowedLinks = new Set([
  "https://wutheringwaves.kurogames.com/en/main/news/detail/758",
  "https://www.bilibili.com/opus/936615544201674759",
  "https://github.com/yunnre060214-sudo/wuwa-convene-planner/blob/main/docs/model.md",
  "https://github.com/yunnre060214-sudo/wuwa-convene-planner/releases/latest",
]);
const smoke = process.argv.includes("--smoke-test");
let window;
let running;

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
ipcMain.handle("solver:calculate", calculate);
ipcMain.on("solver:cancel", (event) => {
  if (authorized(event)) stop();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", stop);
app.whenReady().then(async () => {
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
  app.on("activate", () => {
    if (!window) void createWindow().catch(console.error);
  });
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
