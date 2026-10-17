## PentAGI Local desktop installers

Download the installer for your platform from the assets below. Install Docker
Desktop (Windows/macOS) or Docker Engine with Compose v2 (Linux), start it, and
then open PentAGI Local. First-run setup downloads the local model and service
images, checks the setup, and opens the PentAGI web interface in the desktop
app. See the main [README](https://github.com/omnichan0/My-pent#install-and-start-the-desktop-app)
for full setup instructions and troubleshooting.

### Choose a worker profile

- **Lean curated Kali:** 200+ command-line tools for discovery, web testing,
  reconnaissance, password auditing, traffic analysis, and binary analysis.
  Recommended for most computers; the image is still about 6 GB or more.
- **Curated Kali + systemd:** the same toolset with systemd support for
  service-dependent tools.
- **Curated Kali + chosen add-ons:** add `dnsenum` (DNS), `enum4linux-ng`
  (Windows/SMB), `testssl.sh` (TLS), `net-snmp` (SNMP), `recon-ng`
  (reconnaissance), and/or `zmap` (network measurement and scanning). The
  curated base image is still required.
- **Full Kali suite:** adds the `kali-linux-everything` metapackage. This is a
  very large image; the app enables it only at 32 GB RAM and 100 GB free disk.

PentAGI is built for penetration testing and authorized security assessments.
Its power depends on the tools, target scope, and the quality of instructions
given to the AI; AI suggestions must be reviewed and findings independently
validated. Only test systems you own or have explicit permission to assess.
Workers can reach the network, and Docker socket access is effectively
host-level privilege. Use an isolated machine; do not expose this setup to the
public internet.

The model and other runtime downloads are fetched during first-run setup and
are not bundled into these installers. Check the README for Docker
requirements, model details, and platform-specific guidance.
