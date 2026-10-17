const DOCKER_LINKS = {
  win32: {
    install: "https://www.docker.com/products/docker-desktop/",
    startup: "https://docs.docker.com/desktop/settings-and-maintenance/settings/#general",
    instructions: "Install Docker Desktop, open it once, and enable “Start Docker Desktop when you sign in to your computer” in Settings > General.",
  },
  darwin: {
    install: "https://www.docker.com/products/docker-desktop/",
    startup: "https://docs.docker.com/desktop/settings-and-maintenance/settings/#general",
    instructions: "Install Docker Desktop, open it once, and enable “Start Docker Desktop when you sign in to your computer” in Settings > General.",
  },
  linux: {
    install: "https://docs.docker.com/engine/install/",
    startup: "https://docs.docker.com/engine/install/linux-postinstall/",
    instructions: "Install Docker Engine for your distribution. Enable the docker service at startup (for example, sudo systemctl enable --now docker). Docker-group membership grants host-level privileges.",
  },
};

function dockerLinks(platform) {
  return DOCKER_LINKS[platform] || DOCKER_LINKS.linux;
}

function gitInstallPlan(platform, distroId, tools) {
  if (platform === "win32" && tools.winget) {
    return {
      steps: [{
        command: "winget",
        args: [
          "install", "--id", "Git.Git", "--exact",
          "--accept-source-agreements", "--accept-package-agreements",
        ],
        message: "Installing Git through Windows Package Manager.",
      }],
    };
  }

  if (platform === "linux" && ["debian", "ubuntu"].includes(distroId) && tools.pkexec && tools.aptGet) {
    return {
      steps: [{
        command: "pkexec",
        args: ["apt-get", "install", "-y", "git", "curl"],
        message: "Requesting administrator approval to install Git and curl.",
      }],
    };
  }

  return {
    url: "https://git-scm.com/downloads",
    reason: "Install Git from the opened download page, then restart this app and try again.",
  };
}

module.exports = { dockerLinks, gitInstallPlan };
