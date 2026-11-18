"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { checkForUpdate, releaseUpdate, downloadUpdate, installedBundle } = require("../app/updater.cjs");

const repo = "yunnre060214-sudo/wuwa-convene-planner";
const payload = Buffer.from("release archive fixture");
const version = "1.10.0";
const name = `TidePlanner-${version}-macos-arm64.zip`;
const metadata = {
  tag_name: `v${version}`, draft: false, prerelease: false,
  assets: [{
    name, browser_download_url: `https://github.com/${repo}/releases/download/v${version}/${name}`,
    size: payload.length, state: "uploaded", digest: "sha256:" + createHash("sha256").update(payload).digest("hex"),
  }],
};

test("only a newer stable release with a verified repository asset is offered", async () => {
  const update = await checkForUpdate(async (url, options) => {
    assert.equal(url, `https://api.github.com/repos/${repo}/releases/latest`);
    assert.equal(options.redirect, "error");
    return Response.json(metadata);
  }, "1.9.1");
  assert.equal(update.version, version);
  assert.equal(releaseUpdate(metadata, version), null);
  assert.equal(releaseUpdate(metadata, "2.0.0"), null);
  assert.equal(releaseUpdate({ ...metadata, prerelease: true }, "1.0.0"), null);
  assert.throws(() => releaseUpdate({ ...metadata, assets: [{ ...metadata.assets[0], digest: null }] }, "1.0.0"), /校验信息/);
  assert.throws(() => releaseUpdate({ ...metadata, assets: [{ ...metadata.assets[0], browser_download_url: "https://other.example/file" }] }, "1.0.0"), /校验信息/);
});

test("download permits GitHub's asset host and verifies size and content", async (t) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "tide-test-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const update = releaseUpdate(metadata, "1.0.0");
  const file = path.join(folder, "good.zip");
  const destination = "https://release-assets.githubusercontent.com/fixture";
  let finished = 0;
  await downloadUpdate(async (url) => {
    if (url === update.url) return new Response(null, { status: 302, headers: { location: destination } });
    assert.equal(url, destination);
    return new Response(payload);
  }, update, file, percent => { finished = percent; });
  assert.equal(finished, 100);
  assert.deepEqual(await fs.readFile(file), payload);

  await assert.rejects(downloadUpdate(async () => new Response(Buffer.alloc(payload.length)), update, path.join(folder, "bad.zip"), () => {}), /校验失败/);
  await assert.rejects(downloadUpdate(async () => new Response(Buffer.concat([payload, payload])), update, path.join(folder, "long.zip"), () => {}), /大小/);
  await assert.rejects(downloadUpdate(async () => new Response(null, {
    status: 302, headers: { location: "https://other.example/archive" },
  }), update, path.join(folder, "redirect.zip"), () => {}), /下载地址/);
});

test("install location must be an application bundle executable", () => {
  assert.equal(installedBundle("/Applications/潮汐演算.app/Contents/MacOS/TidePlanner"), "/Applications/潮汐演算.app");
  assert.throws(() => installedBundle("/usr/local/bin/TidePlanner"), /应用程序/);
});
