"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createReadStream } = require("node:fs");
const { Readable } = require("node:stream");
const { createHash } = require("node:crypto");
const { promisify } = require("node:util");
const { execFile } = require("node:child_process");
const { checkForUpdate, prepareUpdate, applyUpdate, removeBackup } = require("../app/updater.cjs");

const run = promisify(execFile);
const version = require("../package.json").version;

async function test() {
  const [archive, scratch] = process.argv.slice(2);
  const testRoot = path.join(scratch, "upgrade");
  const current = "1.1.1";
  const bundle = path.join(testRoot, "潮汐演算.app");
  await fs.mkdir(path.join(bundle, "Contents"), { recursive: true });
  const info = path.join(bundle, "Contents", "Info.plist");
  await fs.copyFile(path.join(scratch, "TidePlanner.app", "Contents", "Info.plist"), info);
  await run("/usr/bin/plutil", ["-replace", "CFBundleShortVersionString", "-string", current, info]);

  const hash = createHash("sha256");
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  const name = path.basename(archive);
  const url = `https://github.com/yunnre060214-sudo/wuwa-convene-planner/releases/download/v${version}/${name}`;
  const metadata = {
    tag_name: "v" + version, draft: false, prerelease: false,
    assets: [{ name, state: "uploaded", size: (await fs.stat(archive)).size, browser_download_url: url, digest: "sha256:" + hash.digest("hex") }],
  };
  const fetcher = async (address) => {
    if (address.startsWith("https://api.github.com/")) return Response.json(metadata);
    assert.equal(address, url);
    return new Response(Readable.toWeb(createReadStream(archive)));
  };

  const update = await checkForUpdate(fetcher, current);
  const prepared = await prepareUpdate({ fetcher, update, bundle, progress() {} });
  const helper = path.join(scratch, "TidePlanner.app", "Contents", "Resources", "swap-app");
  const replacement = { bundle, staged: prepared.staged, helper };
  await assert.rejects(applyUpdate({ ...replacement, current: "1.0.0" }), /版本已变化/);
  await applyUpdate({ ...replacement, current });

  const executable = path.join(bundle, "Contents", "MacOS", "TidePlanner");
  const { stdout } = await run(executable, ["--smoke-test"], { timeout: 90_000 });
  assert.match(stdout, /"smoke":"passed"/);
  await removeBackup(executable, path.basename(prepared.directory), version);
  await assert.rejects(fs.access(prepared.directory), { code: "ENOENT" });
  console.log(`Verified download, bundle swap, upgraded launch and backup cleanup for v${version}.`);
}

test().catch(error => { console.error(error); process.exitCode = 1; });
