const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { dockerLinks, gitInstallPlan } = require("./system-setup.cjs");
const { dockerfileForPackages, resourceGuidance, toolsetPlan } = require("./toolsets.cjs");

const APP_URL = "https://localhost:8443";
const APP_ORIGIN = new URL(APP_URL).origin;
const LOGIN_SETTINGS_PATH = path.join(app.getPath("userData"), "login-settings.json");
const RESOURCE_ROOT = app.isPackaged
  ? process.resourcesPath
  : path.resolve(__dirname, "..");
const APP_DATA_ROOT = path.join(app.getPath("userData"), "setup");
let mainWindow;
let pentagiWindow;
let activeProcess;
let taskRunning = false;

function emit(type, text) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("task:event", { type, text });
  }
}

function commandPath(name) {
  const knownPaths = process.platform === "win32"
    ? {
      docker: [
        path.join(process.env.ProgramFiles || "C:\\Program Files", "Docker", "Docker", "resources", "bin", "docker.exe"),
      ],
      git: [
        path.join(process.env.ProgramFiles || "C:\\Program Files", "Git", "cmd", "git.exe"),
        path.join(process.env.LOCALAPPDATA || "", "Programs", "Git", "cmd", "git.exe"),
      ],
      curl: [path.join(process.env.SystemRoot || "C:\\Windows", "System32", "curl.exe")],
    }
    : {
      docker: ["/opt/homebrew/bin/docker", "/usr/local/bin/docker", "/usr/bin/docker"],
      git: ["/usr/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git"],
      curl: ["/usr/bin/curl", "/opt/homebrew/bin/curl", "/usr/local/bin/curl"],
    };
  const known = knownPaths[name]?.find((candidate) => fs.existsSync(candidate));
  if (known) return known;

  const result = spawnSync(
    process.platform === "win32" ? "where.exe" : "which",
    [name],
    { encoding: "utf8", windowsHide: true },
  );
  return result.status === 0 ? result.stdout.trim().split(/\r?\n/)[0] : null;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    activeProcess = child;
    let output = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output = `${output}${text}`.slice(-262144);
      emit("output", text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      output = `${output}${text}`.slice(-262144);
      emit("output", text);
    });
    child.on("error", (error) => {
      activeProcess = null;
      reject(error);
    });
    child.on("close", (code) => {
      activeProcess = null;
      if (code === 0) {
        resolve(output);
      } else {
        const detail = output.trim().split(/\r?\n/).slice(-8).join("\n");
        reject(new Error(
          `${path.basename(command)} exited with code ${code ?? "unknown"}.${detail ? `\n${detail}` : ""}`,
        ));
      }
    });
  });
}

function copyBootstrapFiles() {
  const files = [
    ["quick-start.sh", "quick-start.sh"],
    ["quick-start.ps1", "quick-start.ps1"],
    ["docker-compose.llama.yml", "docker-compose.llama.yml"],
    ["config/llama.cpp.provider.yml", "config/llama.cpp.provider.yml"],
    ["tests/llama-smoke.yml", "tests/llama-smoke.yml"],
  ];
  fs.mkdirSync(APP_DATA_ROOT, { recursive: true });
  for (const [source, destination] of files) {
    const sourcePath = path.join(RESOURCE_ROOT, source);
    const targetPath = path.join(APP_DATA_ROOT, destination);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Packaged setup file is missing: ${source}`);
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }
}

async function runInstaller(command, args, message) {
  emit("output", `${message}\n`);
  await run(commandPath(command) || command, args);
}

function linuxDistroId() {
  if (process.platform !== "linux" || !fs.existsSync("/etc/os-release")) return "";
  const match = fs.readFileSync("/etc/os-release", "utf8").match(/^ID=(.*)$/m);
  return match ? match[1].replace(/^["']|["']$/g, "").toLowerCase() : "";
}

function installerTools() {
  return {
    winget: Boolean(commandPath("winget")),
    brew: Boolean(commandPath("brew")),
    pkexec: Boolean(commandPath("pkexec")),
    aptGet: Boolean(commandPath("apt-get")),
  };
}

async function openDockerSetup() {
  const links = dockerLinks(process.platform);
  await shell.openExternal(links.install);
  await shell.openExternal(links.startup);
  throw new Error(`Docker is required before setup. ${links.instructions} Install it, make sure it is running, and click Set up & start again.`);
}

async function checkDocker() {
  const docker = commandPath("docker");
  if (!docker) await openDockerSetup();

  emit("output", "Waiting for Docker Engine to be ready...\n");
  let lastError;
  for (let attempt = 0; attempt < 36; attempt += 1) {
    try {
      await run(docker, ["info"]);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (/permission denied|access is denied|not authorized/i.test(error.message)) {
        const links = dockerLinks(process.platform);
        await shell.openExternal(links.startup);
        throw new Error(`Docker is running but this account cannot access it. ${links.instructions} ${error.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  if (lastError) {
    const links = dockerLinks(process.platform);
    await shell.openExternal(links.startup);
    throw new Error(`Docker is installed but did not start. Start Docker Desktop/Engine and retry. ${lastError.message}`);
  }
  try {
    await run(docker, ["compose", "version"]);
  } catch (error) {
    const links = dockerLinks(process.platform);
    await shell.openExternal(links.startup);
    throw new Error(`Docker Compose is unavailable. Install the Compose plugin for your Docker installation. ${error.message}`);
  }
}

async function ensureGit() {
  if (commandPath("git") && commandPath("curl")) return;
  emit("output", "Git is required to fetch PentAGI's pinned source.\n");
  const plan = gitInstallPlan(process.platform, linuxDistroId(), installerTools());
  if (plan.url) {
    await shell.openExternal(plan.url);
    throw new Error(plan.reason);
  }
  for (const step of plan.steps) {
    await runInstaller(step.command, step.args, step.message);
  }
  if (process.platform === "win32") refreshWindowsPath();
  if (!commandPath("git") || !commandPath("curl")) {
    throw new Error("Git or curl is still unavailable. Install the missing tool and restart this app.");
  }
}

function refreshWindowsPath() {
  if (process.platform !== "win32") return;
  const result = spawnSync("powershell.exe", [
    "-NoProfile", "-Command",
    "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')",
  ], { encoding: "utf8", windowsHide: true });
  if (result.status === 0 && result.stdout.trim()) {
    process.env.PATH = `${result.stdout.trim()};${process.env.PATH || ""}`;
  }
}

function launcherCommand(action) {
  const script = process.platform === "win32"
    ? path.join(APP_DATA_ROOT, "quick-start.ps1")
    : path.join(APP_DATA_ROOT, "quick-start.sh");
  const command = process.platform === "win32" ? "powershell.exe" : "/bin/bash";
  const args = process.platform === "win32"
    ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, action]
    : [script, action];
  return { command, args };
}

async function runLauncher(action) {
  const { command, args } = launcherCommand(action);
  emit("state", `Running ${action}...`);
  await run(command, args, { cwd: APP_DATA_ROOT });
}

function hostResources() {
  fs.mkdirSync(APP_DATA_ROOT, { recursive: true });
  const memoryGiB = os.totalmem() / (1024 ** 3);
  const stats = fs.statfsSync(APP_DATA_ROOT);
  const freeDiskGiB = (stats.bavail * stats.bsize) / (1024 ** 3);
  return {
    memoryGiB: Math.floor(memoryGiB),
    freeDiskGiB: Math.floor(freeDiskGiB),
    cpuCount: os.cpus().length,
    ...resourceGuidance(memoryGiB, freeDiskGiB),
  };
}

function updatePentagiEnvironment(values) {
  const envPath = path.join(APP_DATA_ROOT, ".runtime", "pentagi", ".env");
  if (!fs.existsSync(envPath)) {
    throw new Error("PentAGI has not been prepared yet. Select Set up & start first.");
  }
  const content = fs.readFileSync(envPath, "utf8");
  const lines = content.split(/\r?\n/);
  for (const [key, value] of Object.entries(values)) {
    const expression = new RegExp(`^${key}=`);
    const matchingIndex = lines.findIndex((line) => expression.test(line));
    const replacement = `${key}=${value}`;
    if (matchingIndex === -1) lines.push(replacement);
    else lines[matchingIndex] = replacement;
  }
  fs.writeFileSync(envPath, `${lines.filter((line, index) => index < lines.length - 1 || line !== "").join("\n")}\n`, { mode: 0o600 });
}

async function installToolset(profile, tools = [], update = false) {
  const docker = commandPath("docker");
  if (!docker) throw new Error("Docker is not available.");
  const resources = hostResources();
  const plan = toolsetPlan(profile, tools, resources.memoryGiB, resources.freeDiskGiB);
  const imageCheck = spawnSync(docker, ["image", "inspect", plan.image], {
    stdio: "ignore",
    windowsHide: true,
  });
  if (imageCheck.error) throw imageCheck.error;
  const imageExists = imageCheck.status === 0;
  if (imageExists && !update) {
    emit("output", `Reusing worker image ${plan.image}.\n`);
  } else if (plan.pull) {
    emit("output", `Downloading reusable worker image ${plan.image}.\n`);
    await run(docker, ["pull", plan.image]);
  } else {
    emit("output", `${update ? "Updating" : "Building"} reusable worker image ${plan.image}.\n`);
    const context = path.join(APP_DATA_ROOT, "toolbox", profile);
    fs.mkdirSync(context, { recursive: true });
    const dockerfile = path.join(context, "Dockerfile");
    fs.writeFileSync(dockerfile, dockerfileForPackages(plan.packages), { mode: 0o600 });
    await run(docker, [
      "build",
      "--pull",
      ...(update ? ["--no-cache"] : []),
      "--tag", plan.image,
      "--file", dockerfile,
      context,
    ], { cwd: context });
  }
  updatePentagiEnvironment({
    DOCKER_DEFAULT_IMAGE_FOR_PENTEST: plan.image,
    DOCKER_IMAGE_SELECTION_MODE: "fixed",
  });
}

function openPentagiWindow() {
  if (pentagiWindow && !pentagiWindow.isDestroyed()) {
    pentagiWindow.focus();
    return;
  }
  pentagiWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    title: "PentAGI",
    backgroundColor: "#100b12",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  pentagiWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (new URL(url).origin !== APP_ORIGIN) shell.openExternal(url);
    return { action: "deny" };
  });
  pentagiWindow.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== APP_ORIGIN) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
  pentagiWindow.on("closed", () => {
    pentagiWindow = null;
  });
  pentagiWindow.loadURL(APP_URL);
}

async function runQuickStart(action, requestedToolset, updateToolset = false) {
  copyBootstrapFiles();
  emit("state", `Running ${action}...`);
  if (action === "start") {
    await checkDocker();
    await ensureGit();
    const envPath = path.join(APP_DATA_ROOT, ".runtime", "pentagi", ".env");
    const firstSetup = !fs.existsSync(envPath);
    if (firstSetup) await runLauncher("prepare");
    if (requestedToolset || firstSetup) {
      await installToolset(
        requestedToolset?.profile || "base",
        requestedToolset?.tools || [],
        updateToolset,
      );
    }
    await runLauncher("start");
    emit("state", "Ready");
    openPentagiWindow();
    return;
  }
  await runLauncher(action);
  if (action === "stop") emit("state", "Stopped");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 760,
    minHeight: 620,
    title: "PentAGI Local",
    backgroundColor: "#100b12",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.webContents.once("did-finish-load", () => {
    const initialized = fs.existsSync(
      path.join(APP_DATA_ROOT, ".runtime", "pentagi", "docker-compose.yml"),
    );
    if (initialized || process.argv.includes("--autostart")) {
      setTimeout(() => {
        if (!activeProcess && mainWindow && !mainWindow.isDestroyed()) {
          if (taskRunning) return;
          taskRunning = true;
          emit("state", "Starting services...");
          runQuickStart("start")
            .catch((error) => {
              emit("state", "Action failed");
              emit("error", error.message);
            })
            .finally(() => {
              taskRunning = false;
            });
        }
      }, 500);
    }
  });
}

ipcMain.handle("app:action", async (_event, request) => {
  const action = typeof request === "string" ? request : request?.action;
  if (!["start", "stop", "status", "logs"].includes(action)) {
    throw new Error("Unsupported app action.");
  }
  if (taskRunning) return { ok: false, error: "A setup task is already running." };
  taskRunning = true;
  try {
    await runQuickStart(
      action,
      typeof request === "object" ? request.toolset : undefined,
      typeof request === "object" && request.updateToolset === true,
    );
    return { ok: true, action };
  } catch (error) {
    emit("state", "Action failed");
    emit("error", error.message);
    return { ok: false, error: error.message };
  } finally {
    taskRunning = false;
  }
});

ipcMain.handle("app:resources", async () => hostResources());

ipcMain.handle("app:open", async () => {
  openPentagiWindow();
});

ipcMain.handle("app:open-docker-install", async () => {
  await shell.openExternal(dockerLinks(process.platform).install);
});

ipcMain.handle("app:open-docker-startup", async () => {
  await shell.openExternal(dockerLinks(process.platform).startup);
});

ipcMain.handle("app:open-tool-inventory", async () => {
  await shell.openExternal("https://github.com/vxcontrol/kali-linux-image");
});

ipcMain.handle("app:login-setting-state", async () => {
  try {
    const settings = JSON.parse(fs.readFileSync(LOGIN_SETTINGS_PATH, "utf8"));
    return { enabled: Boolean(settings.enabled) };
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    return { enabled: false };
  }
});

ipcMain.handle("app:login-setting", async (_event, enabled) => {
  if (typeof enabled !== "boolean") throw new Error("Invalid login setting.");
  fs.mkdirSync(path.dirname(LOGIN_SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(LOGIN_SETTINGS_PATH, JSON.stringify({ enabled }), { mode: 0o600 });

  if (process.platform === "linux") {
    const autostartDir = path.join(app.getPath("home"), ".config", "autostart");
    const desktopFile = path.join(autostartDir, "pentagi-local.desktop");
    if (enabled) {
      fs.mkdirSync(autostartDir, { recursive: true });
      const executable = app.getPath("exe").replace(/(["\\`$])/g, "\\$1");
      fs.writeFileSync(
        desktopFile,
        `[Desktop Entry]\nType=Application\nName=PentAGI Local\nExec="${executable}" --autostart\nX-GNOME-Autostart-enabled=true\n`,
        { mode: 0o600 },
      );
    } else if (fs.existsSync(desktopFile)) {
      fs.unlinkSync(desktopFile);
    }
  } else {
    app.setLoginItemSettings({ openAtLogin: enabled, args: ["--autostart"] });
  }
  return { enabled };
});

app.whenReady().then(() => {
  app.on("certificate-error", (event, _webContents, url, _error, _certificate, callback) => {
    if (new URL(url).origin === APP_ORIGIN) {
      event.preventDefault();
      callback(true);
    } else {
      callback(false);
    }
  });
  createWindow();
  try {
    const settings = JSON.parse(fs.readFileSync(LOGIN_SETTINGS_PATH, "utf8"));
    if (settings.enabled && process.platform !== "linux" && !process.argv.includes("--autostart")) {
      app.setLoginItemSettings({ openAtLogin: true, args: ["--autostart"] });
    }
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on("before-quit", () => {
  if (activeProcess) activeProcess.kill();
});
