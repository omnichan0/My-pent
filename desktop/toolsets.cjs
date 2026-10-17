const { createHash } = require("node:crypto");

const KALI_BASE = "vxcontrol/kali-linux:latest";
const FULL_KALI_IMAGE = "pentagi-local/kali-tools:full";
const FULL_KALI_RAM_GIB = 32;
const FULL_KALI_DISK_GIB = 100;

const TOOL_CATALOG = Object.freeze({
  nmap: { label: "Nmap", description: "Network discovery and port scanning" },
  sqlmap: { label: "SQLmap", description: "SQL injection testing" },
  nikto: { label: "Nikto", description: "Web server checks" },
  gobuster: { label: "Gobuster", description: "Directory and DNS discovery" },
  hydra: { label: "Hydra", description: "Authorized login auditing" },
  john: { label: "John the Ripper", description: "Password hash auditing" },
  amass: { label: "Amass", description: "Attack surface mapping" },
  tshark: { label: "TShark", description: "Network protocol analysis tools" },
});

function resourceGuidance(memoryGiB, freeDiskGiB) {
  const fullSuiteAvailable = memoryGiB >= FULL_KALI_RAM_GIB && freeDiskGiB >= FULL_KALI_DISK_GIB;
  const standardAvailable = memoryGiB >= 16 && freeDiskGiB >= 40;
  return {
    fullSuiteAvailable,
    recommended: fullSuiteAvailable
      ? "standard"
      : standardAvailable
        ? "standard"
        : "base",
    message: fullSuiteAvailable
      ? `Full Kali is available on this computer (at least ${FULL_KALI_RAM_GIB} GB RAM and ${FULL_KALI_DISK_GIB} GB free disk estimated). It can use substantially more storage while building and updating.`
      : `Use the standard worker image or selected tools. Full Kali is gated until this computer reports at least ${FULL_KALI_RAM_GIB} GB RAM and ${FULL_KALI_DISK_GIB} GB free disk.`,
  };
}

function toolsetPlan(profile, selectedTools, memoryGiB, freeDiskGiB) {
  if (profile === "base") {
    return { image: KALI_BASE, pull: true, packages: [] };
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
  TOOL_CATALOG,
  dockerfileForPackages,
  resourceGuidance,
  toolsetPlan,
};
