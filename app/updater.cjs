"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { createWriteStream } = require("node:fs");
const { createHash } = require("node:crypto");
const { Transform, Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const run = promisify(execFile);
const repository = "yunnre060214-sudo/wuwa-convene-planner";
const releaseAPI = `https://api.github.com/repos/${repository}/releases/latest`;
const releases = `https://github.com/${repository}/releases/latest`;
const bundleID = "io.github.yunnre060214-sudo.wuwa-convene-planner";
const appName = "TidePlanner.app";
const backupName = /^\.tide-update-[A-Za-z0-9]{6}$/;
const versionPattern = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
const releaseHosts = new Set(["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"]);

function isNewer(candidate, current) {
  const candidateParts = versionPattern.exec(candidate);
  const currentParts = versionPattern.exec(current);
  if (!candidateParts || !currentParts) throw new Error("版本号无法识别。");
  for (let index = 1; index <= 3; index++) {
    const delta = Number(candidateParts[index]) - Number(currentParts[index]);
    if (delta) return delta > 0;
  }
  return false;
}

function releaseUpdate(metadata, current) {
  if (!metadata || typeof metadata.tag_name !== "string" || !metadata.tag_name.startsWith("v")) {
    throw new Error("无法识别 GitHub 上的版本信息。");
  }
  const version = metadata.tag_name.slice(1);
  if (metadata.draft || metadata.prerelease || !isNewer(version, current)) return null;
  const name = `TidePlanner-${version}-macos-arm64.zip`;
  const url = `https://github.com/${repository}/releases/download/v${version}/${name}`;
  const asset = metadata.assets?.find(entry => entry.name === name);
  if (!asset || asset.browser_download_url !== url || asset.state !== "uploaded" ||
      !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > 512 * 1024 * 1024 ||
      !/^sha256:[0-9a-f]{64}$/.test(asset.digest)) {
    throw new Error("新版安装包或校验信息还未就绪，请稍后再试。");
  }
  return { version, url, size: asset.size, sha256: asset.digest.slice(7) };
}

async function checkForUpdate(fetcher, current) {
  const response = await fetcher(releaseAPI, {
    redirect: "error",
    headers: { Accept: "application/vnd.github+json", "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`暂时无法检查 GitHub 上的版本（${response.status}）。`);
  return releaseUpdate(await response.json(), current);
}

async function downloadUpdate(fetcher, update, archive, progress) {
  const signal = AbortSignal.timeout(10 * 60_000);
  let url = new URL(update.url);
  let response;
  for (let redirects = 0; redirects <= 4; redirects++) {
    if (url.protocol !== "https:" || url.port || url.username || url.password || !releaseHosts.has(url.hostname)) {
      throw new Error("下载地址无法验证。");
    }
    response = await fetcher(url.href, { redirect: "manual", signal });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location || redirects === 4) throw new Error("下载地址无法验证。");
    url = new URL(location, url);
  }
  if (!response.ok || !response.body) throw new Error("暂时无法下载新版。");
  const hash = createHash("sha256");
  let size = 0;
  let shown = -1;
  const inspect = new Transform({
    transform(chunk, _encoding, done) {
      size += chunk.length;
      if (size > update.size) return done(new Error("下载文件大小与发布记录不符。"));
      hash.update(chunk);
      const percent = Math.floor(size * 100 / update.size);
      if (percent !== shown) {
        shown = percent;
        progress(percent);
      }
      done(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), inspect, createWriteStream(archive, { flags: "wx", mode: 0o600 }), { signal });
  if (size !== update.size || hash.digest("hex") !== update.sha256) {
    throw new Error("新版安装包校验失败。请重新检查更新。");
  }
}

async function plist(bundle, key) {
  const { stdout } = await run("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", path.join(bundle, "Contents", "Info.plist")]);
  return stdout.trim();
}

async function verifyBundle(bundle, version) {
  const [identifier, foundVersion, executable] = await Promise.all([
    plist(bundle, "CFBundleIdentifier"), plist(bundle, "CFBundleShortVersionString"), plist(bundle, "CFBundleExecutable"),
  ]);
  if (identifier !== bundleID || foundVersion !== version || executable !== "TidePlanner") {
    throw new Error("安装包里的应用与发布版本不符。");
  }
  const binary = await fs.open(path.join(bundle, "Contents", "MacOS", executable), "r");
  try {
    const header = Buffer.alloc(8);
    const { bytesRead } = await binary.read(header);
    if (bytesRead !== 8 || header.readUInt32LE(0) !== 0xfeedfacf || header.readUInt32LE(4) !== 0x0100000c) {
      throw new Error("下载的应用无法在 Apple Silicon 上安装。");
    }
  } finally {
    await binary.close();
  }
  await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundle]);
}

function installedBundle(executable) {
  const bundle = path.resolve(executable, "../../..");
  if (!bundle.endsWith(".app") || path.join(bundle, "Contents", "MacOS", "TidePlanner") !== executable) {
    throw new Error("请先将应用移入「应用程序」再安装更新。");
  }
  return bundle;
}

async function prepareUpdate({ fetcher, update, bundle, progress }) {
  let directory;
  try {
    directory = await fs.mkdtemp(path.join(path.dirname(bundle), ".tide-update-"));
    await fs.chmod(directory, 0o700);
    const archive = path.join(directory, "update.zip");
    await downloadUpdate(fetcher, update, archive, progress);
    progress(null);
    await run("/usr/bin/ditto", ["-x", "-k", archive, directory], { timeout: 120_000 });
    const staged = path.join(directory, appName);
    if (!(await fs.lstat(staged)).isDirectory()) throw new Error("新版安装包缺少应用。");
    await verifyBundle(staged, update.version);
    await fs.unlink(archive);
    return { directory, staged };
  } catch (error) {
    if (directory) await fs.rm(directory, { recursive: true, force: true }).catch(console.error);
    if (["EACCES", "EPERM", "EROFS"].includes(error.code)) {
      throw new Error("当前位置没有更新权限。可将应用移入可写的「应用程序」文件夹，或从发布页手动替换。");
    }
    throw error;
  }
}

async function applyUpdate({ bundle, staged, current, helper }) {
  if (await plist(bundle, "CFBundleShortVersionString") !== current) {
    throw new Error("应用版本已变化，请重新打开后检查更新。");
  }
  await run(helper, [bundle, staged]);
}

async function removeBackup(executable, name, current) {
  if (!backupName.test(name)) return;
  const directory = path.join(path.dirname(installedBundle(executable)), name);
  const backup = path.join(directory, appName);
  if (!(await fs.lstat(directory)).isDirectory() || !(await fs.lstat(backup)).isDirectory()) return;
  const [identifier, version] = await Promise.all([plist(backup, "CFBundleIdentifier"), plist(backup, "CFBundleShortVersionString")]);
  if (identifier !== bundleID || !isNewer(current, version)) return;
  await fs.rm(backup, { recursive: true });
  await fs.rmdir(directory);
}

module.exports = { releases, releaseUpdate, checkForUpdate, downloadUpdate, installedBundle, prepareUpdate, applyUpdate, removeBackup };
