# PentAGI + llama.cpp Quick Start

Run PentAGI with a local llama.cpp model on Windows, macOS, or Linux. The
quick-start scripts fetch the pinned PentAGI source and model files, create
private local credentials, configure the LLM and embedding providers, start
the Docker Compose services, and run provider smoke tests.

The application architecture remains PentAGI's upstream architecture. This
repository adds a small bootstrap layer and a Compose override for llama.cpp;
upstream source and model weights are fetched at setup time rather than copied
into this repository.

## Before you start

- Windows 10/11, macOS, or Linux on x86-64 or ARM64.
- Docker Desktop (Windows/macOS) or Docker Engine with the Compose v2 plugin
  (Linux), started and available to your account.
- Git, `curl`, and about 40 GB of free disk space for containers and model
  downloads.
- At least 16 GB of system memory and 4 CPU cores recommended. The selected
  3B model runs on CPU by default; inference speed depends on your hardware.
- An internet connection for the initial source, image, and model downloads.
  LLM inference and embeddings run locally after setup; no cloud model API key
  is required.

## Start

Download or clone this repository, then run the launcher for your operating
system from its root directory:

**Windows Command Prompt (CMD):**

```bat
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\quick-start.ps1
```

**Windows PowerShell or PowerShell 7 terminal:**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\quick-start.ps1
# Or, with PowerShell 7:
pwsh -NoProfile -File .\quick-start.ps1
```

**macOS or Linux:**

```sh
bash ./quick-start.sh
```

On the first run, the launcher:

1. Checks that Docker Compose and the Docker service are available.
2. Fetches the pinned PentAGI source into `.runtime/pentagi/`.
3. Downloads the selected G9v3 GGUF and Nomic embedding GGUF and verifies each
   file against its pinned SHA-256 checksum.
4. Creates a local `.env` with random database and signing credentials; the
   file is kept under `.runtime/` and is not committed.
5. Starts the upstream PentAGI Compose stack plus two llama.cpp server
   containers, configured as PentAGI's chat and embedding providers.
6. Runs PentAGI's `ctester` tool-call smoke test and `etester` embedding/database
   test before reporting the local URL.

Open **https://localhost:8443** once the launcher reports success. The initial
login is `admin@pentagi.com` with password `admin`; change it immediately.
Because the local HTTPS certificate is self-signed, the browser may show a
certificate warning on first access.

## Manage the local stack

Run these from the repository root:

| Action | Windows | macOS / Linux |
| --- | --- | --- |
| Start and verify | `.\quick-start.ps1 start` | `bash ./quick-start.sh start` |
| Show service status | `.\quick-start.ps1 status` | `bash ./quick-start.sh status` |
| Show recent logs | `.\quick-start.ps1 logs` | `bash ./quick-start.sh logs` |
| Stop without deleting data | `.\quick-start.ps1 stop` | `bash ./quick-start.sh stop` |

The scripts preserve `.runtime/pentagi/` and Docker volumes when stopped. Use
the `logs` action to review the latest service output. The generated
credentials and model files are stored under `.runtime/pentagi/`.

## What's configured

- PentAGI's upstream services, including PostgreSQL/pgvector and the isolated
  tool execution services.
- The G9v3-3B-Heretic-Abliterated-Q8_0 model via llama.cpp's OpenAI-compatible
  chat API, available to PentAGI's agent roles.
- Nomic Embed Text v1.5 via llama.cpp's embedding API for PentAGI memory and
  vector search.
- Per-agent inference settings, an 8K chat context, and a bounded output size
  suited to this local model.
- Random local credentials and localhost-only access; the LLM services are
  reachable by PentAGI over its internal Docker network and are not published
  to the LAN.

## Safety and licensing

Use PentAGI only against systems you own or are explicitly authorized to test.
PentAGI can execute security tools in worker containers. The standard
deployment gives it access to the Docker API; Docker socket access is
effectively host-level privilege, so use a dedicated or otherwise isolated
machine and do not expose this local setup to the public internet.

The selected G9v3 model is described by its publisher as an abliterated,
uncensored variant with reduced refusal behavior. That model behavior is a
deliberate selection, not a PentAGI safeguard. The G9v3 and Nomic model files
are downloaded from their publishers under Apache-2.0 terms; their weights are
not included in Git. PentAGI and llama.cpp remain their respective upstream
projects and licenses; their source is fetched into the ignored runtime
directory rather than vendored here.
