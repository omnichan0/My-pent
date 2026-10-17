const { createHash } = require("node:crypto");

const KALI_BASE = "vxcontrol/kali-linux:latest";
const SYSTEMD_KALI_IMAGE = "vxcontrol/kali-linux:systemd";
const FULL_KALI_IMAGE = "pentagi-local/kali-tools:full";
const PERSISTENT_KALI_IMAGE = "pentagi-local/kali-tools:approved";
const STANDARD_RAM_GIB = 16;
const STANDARD_DISK_GIB = 40;
const FULL_KALI_RAM_GIB = 32;
const FULL_KALI_DISK_GIB = 100;

const TOOL_CATALOG = Object.freeze({
  dnsenum: { label: "dnsenum", description: "DNS enumeration" },
  "enum4linux-ng": { label: "enum4linux-ng", description: "Windows and SMB enumeration" },
  "testssl.sh": { label: "testssl.sh", description: "TLS/SSL configuration checks" },
  "net-snmp": { label: "Net-SNMP", description: "SNMP discovery and queries" },
  "recon-ng": { label: "Recon-ng", description: "Modular reconnaissance framework" },
  zmap: { label: "ZMap", description: "Network measurement and scanning" },
});

function resourceGuidance(memoryGiB, freeDiskGiB) {
  const standardRecommended = memoryGiB >= STANDARD_RAM_GIB && freeDiskGiB >= STANDARD_DISK_GIB;
  const fullSuiteAvailable = memoryGiB >= FULL_KALI_RAM_GIB && freeDiskGiB >= FULL_KALI_DISK_GIB;
  return {
    standardRecommended,
    fullSuiteAvailable,
    recommendedProfile: "base",
    message: fullSuiteAvailable
      ? `Full Kali is available on this computer (at least ${FULL_KALI_RAM_GIB} GB RAM and ${FULL_KALI_DISK_GIB} GB free disk estimated). It can use substantially more storage while building and updating.`
      : standardRecommended
        ? `Standard setup is recommended (at least ${STANDARD_RAM_GIB} GB RAM and ${STANDARD_DISK_GIB} GB free disk). Selected tools are added to the same roughly 6 GB upstream worker image; the lightweight "test" image is not a usable pentest worker.`
        : `This computer is below the recommended ${STANDARD_RAM_GIB} GB RAM / ${STANDARD_DISK_GIB} GB free-disk baseline. The selected-tools option adds fewer packages but still needs the roughly 6 GB upstream worker image. Full Kali is unavailable.`,
  };
}

function toolsetPlan(profile, selectedTools, memoryGiB, freeDiskGiB) {
  if (profile === "base") {
    return { image: KALI_BASE, pull: true, packages: [] };
  }
  if (profile === "systemd") {
    return { image: SYSTEMD_KALI_IMAGE, pull: true, packages: [] };
  }
  if (profile === "full") {
    const resources = resourceGuidance(memoryGiB, freeDiskGiB);
    if (!resources.fullSuiteAvailable) {
      throw new Error(resources.message);
    }
    return { image: FULL_KALI_IMAGE, pull: false, packages: ["kali-linux-everything"] };
  }
  if (profile === "custom") {
    if (!Array.isArray(selectedTools) || selectedTools.length === 0) {
      throw new Error("Select at least one tool for a reusable custom toolbox.");
    }
    const uniqueTools = [...new Set(selectedTools)];
    const unknownTools = uniqueTools.filter((tool) => !Object.hasOwn(TOOL_CATALOG, tool));
    if (unknownTools.length) {
      throw new Error(`Unsupported tool selection: ${unknownTools.join(", ")}`);
    }
    const packages = uniqueTools.sort();
    const profileHash = createHash("sha256").update(packages.join("\n")).digest("hex").slice(0, 12);
    return {
      image: `pentagi-local/kali-tools:custom-${profileHash}`,
      pull: false,
      packages,
    };
  }
  throw new Error("Choose the standard Kali image, full Kali suite, or a custom toolbox.");
}

function dockerfileForPackages(packages) {
  if (!Array.isArray(packages) || packages.length === 0) {
    throw new Error("Cannot build a toolbox without selected packages.");
  }
  for (const packageName of packages) {
    if (!Object.hasOwn(TOOL_CATALOG, packageName) && packageName !== "kali-linux-everything") {
      throw new Error(`Unsupported package: ${packageName}`);
    }
  }
  return [
    `FROM ${KALI_BASE}`,
    "ENV DEBIAN_FRONTEND=noninteractive",
    `RUN apt-get update && apt-get install -y --no-install-recommends ${packages.join(" ")} && rm -rf /var/lib/apt/lists/*`,
    "",
  ].join("\n");
}

module.exports = {
  FULL_KALI_DISK_GIB,
  FULL_KALI_IMAGE,
  FULL_KALI_RAM_GIB,
  KALI_BASE,
  PERSISTENT_KALI_IMAGE,
  SYSTEMD_KALI_IMAGE,
  STANDARD_DISK_GIB,
  STANDARD_RAM_GIB,
  TOOL_CATALOG,
  dockerfileForPackages,
  resourceGuidance,
  toolsetPlan,
};
