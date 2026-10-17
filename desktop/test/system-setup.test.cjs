const test = require("node:test");
const assert = require("node:assert/strict");
const { dockerLinks, gitInstallPlan } = require("../system-setup.cjs");

test("Docker setup links provide install and startup instructions for Windows", () => {
  const links = dockerLinks("win32");
  assert.match(links.install, /docker\.com/);
  assert.match(links.startup, /docs\.docker\.com/);
  assert.match(links.instructions, /Start Docker Desktop when you sign in/);
});

test("Docker setup links provide install and startup instructions for macOS", () => {
  const links = dockerLinks("darwin");
  assert.match(links.install, /docker\.com/);
  assert.match(links.startup, /docs\.docker\.com/);
});

test("Linux Docker setup links use the Engine installation and post-install guides", () => {
  const links = dockerLinks("linux");
  assert.match(links.install, /engine\/install/);
  assert.match(links.startup, /linux-postinstall/);
  assert.match(links.instructions, /systemctl enable --now docker/);
});

test("unsupported platforms get Linux's official Docker instructions", () => {
  assert.equal(dockerLinks("freebsd"), dockerLinks("linux"));
});

test("Git installer is selected by platform and package manager", () => {
  assert.ok(gitInstallPlan("win32", "", { winget: true }).steps[0].args.includes("Git.Git"));
  assert.deepEqual(
    gitInstallPlan("linux", "debian", { pkexec: true, aptGet: true }).steps[0].args.slice(0, 2),
    ["apt-get", "install"],
  );
  assert.match(gitInstallPlan("darwin", "", {}).url, /git-scm\.com/);
});
