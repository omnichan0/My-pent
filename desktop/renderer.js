const status = document.getElementById("status-text");
const statusBadge = document.querySelector(".status");
const consoleView = document.getElementById("console");
const controls = [...document.querySelectorAll("button, input")];
let busy = false;

function setBusy(value) {
  busy = value;
  for (const button of controls) {
    button.disabled = value;
  }
}

function append(text) {
  if (consoleView.textContent.startsWith("Welcome.")) consoleView.textContent = "";
  consoleView.textContent += text;
  if (consoleView.textContent.length > 200000) {
    consoleView.textContent = consoleView.textContent.slice(-200000);
  }
  consoleView.scrollTop = consoleView.scrollHeight;
}

function setStatus(text, state = "") {
  status.textContent = text;
  statusBadge.classList.remove("ready", "error");
  if (state) statusBadge.classList.add(state);
}

window.pentagiDesktop.onEvent(({ type, text }) => {
  if (type === "output") append(text);
  if (type === "error") append(`\nERROR: ${text}\n`);
  if (type === "state") setStatus(text, text === "Ready" ? "ready" : text === "Action failed" ? "error" : "");
});

function selectedToolset() {
  return {
    profile: document.querySelector('input[name="profile"]:checked').value,
    tools: [...document.querySelectorAll('input[name="tool"]:checked')].map((input) => input.value),
  };
}

async function action(name, toolset) {
  if (busy) return;
  if (name === "start" && toolset?.profile === "full" &&
      !window.confirm("The full Kali suite is very large and can use tens of gigabytes of Docker storage. Build and activate it?")) {
    return;
  }
  if (name === "start" && toolset?.profile === "custom" &&
      !window.confirm("Build and activate a reusable Docker worker image with the selected tools?")) {
    return;
  }
  setBusy(true);
  setStatus(name === "start" ? "Preparing workspace..." : `${name}...`);
  append(`\n> ${name}\n`);
  const request = name === "start" ? { action: name, toolset } : name;
  try {
    const result = await window.pentagiDesktop.action(request);
    if (result.ok) {
      if (name === "status" || name === "logs") setStatus("Command complete");
      if (name === "start") {
        append("\nSetup checks passed. Opening PentAGI in your browser...\n");
      }
    } else {
      setStatus("Action failed", "error");
      append(`\nERROR: ${result.error}\n`);
    }
  } catch (error) {
    setStatus("Action failed", "error");
    append(`\nERROR: ${error.message}\n`);
  } finally {
    setBusy(false);
  }
}

document.getElementById("start").addEventListener("click", () => action("start"));
document.getElementById("apply-toolset").addEventListener("click", () => action("start", selectedToolset()));
document.getElementById("stop").addEventListener("click", () => action("stop"));
document.getElementById("status").addEventListener("click", () => action("status"));
document.getElementById("logs").addEventListener("click", () => action("logs"));
document.getElementById("open").addEventListener("click", () => window.pentagiDesktop.openApp());
document.getElementById("docker-install").addEventListener("click", () => window.pentagiDesktop.openDockerInstall());
document.getElementById("docker-startup").addEventListener("click", () => window.pentagiDesktop.openDockerStartup());
document.getElementById("clear").addEventListener("click", () => {
  consoleView.textContent = "";
});

const fullOption = document.querySelector('input[name="profile"][value="full"]');
const fullLabel = document.getElementById("full-profile");
const resourceText = document.getElementById("resource-guidance");
window.pentagiDesktop.resources().then((resources) => {
  resourceText.textContent = `${resources.memoryGiB} GB RAM • ${resources.freeDiskGiB} GB free on the app's data drive. ${resources.message}`;
  fullOption.disabled = !resources.fullSuiteAvailable;
  fullLabel.classList.toggle("disabled", fullOption.disabled);
}).catch((error) => {
  resourceText.textContent = `Resource check failed: ${error.message}. Full Kali will remain unavailable for safety.`;
  fullOption.disabled = true;
  fullLabel.classList.add("disabled");
});

const toolOptions = [...document.querySelectorAll('input[name="tool"]')];
function updateToolOptions() {
  const customSelected = document.querySelector('input[name="profile"][value="custom"]').checked;
  for (const input of toolOptions) input.disabled = !customSelected;
}
for (const input of document.querySelectorAll('input[name="profile"]')) {
  input.addEventListener("change", updateToolOptions);
}
updateToolOptions();

const loginToggle = document.getElementById("launch-at-login");
window.pentagiDesktop.getLoginSetting().then(({ enabled }) => {
  loginToggle.checked = enabled;
});
loginToggle.addEventListener("change", async () => {
  loginToggle.disabled = true;
  try {
    const result = await window.pentagiDesktop.setLoginSetting(loginToggle.checked);
    loginToggle.checked = result.enabled;
    append(`\nLaunch at sign-in ${result.enabled ? "enabled" : "disabled"}.\n`);
  } catch (error) {
    loginToggle.checked = !loginToggle.checked;
    append(`\nERROR: Could not update sign-in setting: ${error.message}\n`);
  } finally {
    loginToggle.disabled = busy;
  }
});
