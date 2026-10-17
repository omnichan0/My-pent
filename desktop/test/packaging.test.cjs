const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifest = require("../package.json");

test("Windows installer creates shortcuts and launches the app after installation", () => {
  assert.deepEqual(manifest.build.win.target, ["nsis"]);
  assert.equal(
    manifest.build.win.artifactName,
    "${productName}-${version}-${arch}-setup.${ext}",
  );
  assert.equal(manifest.build.nsis.oneClick, false);
  assert.equal(manifest.build.nsis.createDesktopShortcut, true);
  assert.equal(manifest.build.nsis.createStartMenuShortcut, true);
  assert.equal(manifest.build.nsis.runAfterFinish, true);
  assert.equal(manifest.build.nsis.deleteAppDataOnUninstall, false);
});

test("each desktop platform has a valid branded application icon", () => {
  const assets = path.join(root, "assets");
  const png = fs.readFileSync(path.join(assets, "pentagi-icon.png"));
  const ico = fs.readFileSync(path.join(assets, "pentagi-icon.ico"));
  const icns = fs.readFileSync(path.join(assets, "pentagi-icon.icns"));

  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt32LE(18), 22);
  assert.equal(icns.subarray(0, 4).toString(), "icns");
  assert.equal(icns.readUInt32BE(4), icns.length);
  assert.equal(manifest.build.win.icon, "assets/pentagi-icon.ico");
  assert.equal(manifest.build.mac.icon, "assets/pentagi-icon.icns");
  assert.equal(manifest.build.linux.icon, "assets/pentagi-icon.png");
});

test("Linux releases provide an installable package and portable app", () => {
  assert.deepEqual(manifest.build.linux.target, ["AppImage", "deb"]);
  assert.equal(manifest.build.linux.packageCategory, "devel");
});

test("release workflow uploads only installer files, not build directories", () => {
  const workflow = fs.readFileSync(
    path.resolve(root, "../.github/workflows/desktop-release.yml"),
    "utf8",
  );

  assert.match(workflow, /files: desktop\/dist\/\*\.exe/);
  assert.match(workflow, /desktop\/dist\/\*\.dmg/);
  assert.match(workflow, /desktop\/dist\/\*\.zip/);
  assert.match(workflow, /desktop\/dist\/\*\.AppImage/);
  assert.match(workflow, /desktop\/dist\/\*\.deb/);
  assert.match(workflow, /path: \$\{\{ matrix\.files \}\}/);
  assert.match(workflow, /--notes-file \.github\/RELEASE_NOTES\.md/);
  assert.match(workflow, /--title "PentAGI Local v\$release_version"/);
});

test("end-user bootstrap resources are bundled into desktop releases", () => {
  const resourceNames = manifest.build.extraResources.map((entry) => entry.to);
  assert.ok(resourceNames.includes("quick-start.ps1"));
  assert.ok(resourceNames.includes("quick-start.sh"));
  assert.ok(resourceNames.includes("docker-compose.llama.yml"));
  assert.ok(manifest.build.files.includes("assets/*.svg"));
});
