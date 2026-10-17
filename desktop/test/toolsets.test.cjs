const test = require("node:test");
const assert = require("node:assert/strict");
const {
  FULL_KALI_IMAGE,
  KALI_BASE,
  SYSTEMD_KALI_IMAGE,
  TOOL_CATALOG,
  dockerfileForPackages,
  resourceGuidance,
  toolsetPlan,
} = require("../toolsets.cjs");

test("resource guidance recommends a standard image and gates full Kali on small machines", () => {
  const guidance = resourceGuidance(16, 40);
  assert.equal(guidance.standardRecommended, true);
  assert.equal(guidance.recommendedProfile, "base");
  assert.equal(guidance.fullSuiteAvailable, false);
  assert.match(guidance.message, /same roughly 6 GB upstream worker image/);
});

test("low-resource guidance explains that selected packages do not avoid the Kali base image", () => {
  const guidance = resourceGuidance(8, 20);
  assert.equal(guidance.standardRecommended, false);
  assert.match(guidance.message, /below the recommended/);
  assert.match(guidance.message, /still needs the roughly 6 GB upstream worker image/);
});

test("full Kali is available only above conservative host resource thresholds", () => {
  assert.equal(resourceGuidance(32, 100).fullSuiteAvailable, true);
  assert.equal(resourceGuidance(32, 99).fullSuiteAvailable, false);
});

test("standard toolbox pulls the upstream maintained PentAGI Kali image", () => {
  assert.deepEqual(toolsetPlan("base", [], 8, 20), {
    image: KALI_BASE,
    pull: true,
    packages: [],
  });
});

test("systemd toolbox uses the maintained upstream systemd variant", () => {
  assert.deepEqual(toolsetPlan("systemd", [], 16, 40), {
    image: SYSTEMD_KALI_IMAGE,
    pull: true,
    packages: [],
  });
});

test("full toolbox plans a reusable image with the Kali full-suite metapackage", () => {
  const plan = toolsetPlan("full", [], 64, 300);
  assert.equal(plan.image, FULL_KALI_IMAGE);
  assert.deepEqual(plan.packages, ["kali-linux-everything"]);
});

test("custom toolbox only accepts catalog entries and removes duplicate selections", () => {
  const plan = toolsetPlan("custom", ["zmap", "dnsenum", "zmap"], 16, 50);
  assert.match(plan.image, /^pentagi-local\/kali-tools:custom-[a-f0-9]{12}$/);
  assert.deepEqual(plan.packages, ["dnsenum", "zmap"]);
  assert.equal(plan.image, toolsetPlan("custom", ["dnsenum", "zmap"], 16, 50).image);
  assert.throws(() => toolsetPlan("custom", ["curl; id"], 16, 50), /Unsupported tool selection/);
  assert.throws(() => toolsetPlan("custom", [], 16, 50), /at least one tool/);
});

test("Dockerfile uses the fixed Kali base and only validated packages", () => {
  assert.equal(
    dockerfileForPackages(["dnsenum", "zmap"]),
    `FROM ${KALI_BASE}\nENV DEBIAN_FRONTEND=noninteractive\nRUN apt-get update && apt-get install -y --no-install-recommends dnsenum zmap && rm -rf /var/lib/apt/lists/*\n`,
  );
  assert.throws(() => dockerfileForPackages(["; rm -rf /"]), /Unsupported package/);
  assert.equal(Object.keys(TOOL_CATALOG).length, 6);
});
