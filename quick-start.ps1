param(
    [ValidateSet("prepare", "start", "stop", "status", "logs")]
    [string]$Action = "start"
)

$ErrorActionPreference = "Stop"
$RootDir = $PSScriptRoot
$RuntimeDir = Join-Path $RootDir ".runtime/pentagi"
$ModelsDir = Join-Path $RuntimeDir "models"
$PentagiRef = "843dfeb4bfc809c09d1bc5022e567c602d8fc9dd"
$PentagiRepository = "https://github.com/vxcontrol/pentagi.git"
$ChatModel = "G9v3-3B-Heretic-Abliterated-Q8_0.gguf"
$ChatModelUrl = "https://huggingface.co/Vortecks/G9v3-3B-Heretic-Abliterated-GGUF/resolve/09c854e0787d56f8482433e6973a04d94f9087b1/$ChatModel"
$ChatModelSha256 = "405ac09db37cb6f4c3edb4dcff9d5b8c4b10b1a57c5575fdaeb07617b5032de8"
$EmbedModel = "nomic-embed-text-v1.5.Q4_K_M.gguf"
$EmbedModelUrl = "https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/0188c9bf409793f810680a5a431e7b899c46104c/$EmbedModel"
$EmbedModelSha256 = "d4e388894e09cf3816e8b0896d81d265b55e7a9fff9ab03fe8bf4ef5e11295ac"

function Get-ExternalCommand([string]$Name) {
    foreach ($Candidate in @("$Name.exe", $Name)) {
        $Command = Get-Command $Candidate -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($Command) {
            return $Command.Path
        }
    }
    throw "Required command not found: $Name"
}

function Invoke-DockerCompose([string[]]$ComposeArgs) {
    $DockerCommand = Get-ExternalCommand "docker"
    $ComposeArguments = @(
        "compose",
        "--project-directory", $RuntimeDir,
        "--env-file", (Join-Path $RuntimeDir ".env"),
        "-f", (Join-Path $RuntimeDir "docker-compose.yml"),
        "-f", (Join-Path $RootDir "docker-compose.llama.yml")
    ) + $ComposeArgs
    & $DockerCommand @ComposeArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose failed with exit code $LASTEXITCODE."
    }
}

function Get-Sha256([string]$Path) {
    (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Ensure-Model([string]$Name, [string]$Url, [string]$ExpectedHash) {
    $Destination = Join-Path $ModelsDir $Name
    $Partial = "$Destination.part"
    if (Test-Path -LiteralPath $Destination) {
        if ((Get-Sha256 $Destination) -ne $ExpectedHash) {
            throw "Checksum mismatch for $Name; the existing file was left untouched."
        }
        return
    }

    Write-Host "Downloading $Name (first run only)..."
    & $script:CurlCommand --fail --location --retry 3 --output $Partial $Url
    if ($LASTEXITCODE -ne 0) {
        Remove-Item -Force -ErrorAction SilentlyContinue -LiteralPath $Partial
        throw "Download failed for $Name."
    }
    if ((Get-Sha256 $Partial) -ne $ExpectedHash) {
        Remove-Item -Force -ErrorAction SilentlyContinue -LiteralPath $Partial
        throw "Checksum mismatch for downloaded $Name."
    }
    Move-Item -Force -LiteralPath $Partial -Destination $Destination
}

function Prepare-Runtime {
    $script:GitCommand = Get-ExternalCommand "git"
    $script:DockerCommand = Get-ExternalCommand "docker"
    $script:CurlCommand = Get-ExternalCommand "curl"

    & $script:DockerCommand compose version *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose v2 is required."
    }
    & $script:DockerCommand info *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "Start Docker Desktop, then rerun this command."
    }

    $ParentDir = Split-Path -Parent $RuntimeDir
    New-Item -ItemType Directory -Force -Path $ParentDir | Out-Null
    if (Test-Path -LiteralPath (Join-Path $RuntimeDir ".git")) {
        $Origin = (& $script:GitCommand -C $RuntimeDir remote get-url origin).Trim()
        $Revision = (& $script:GitCommand -C $RuntimeDir rev-parse HEAD).Trim()
        if ($LASTEXITCODE -ne 0 -or $Origin -ne $PentagiRepository -or $Revision -ne $PentagiRef) {
            throw "$RuntimeDir is not the expected official PentAGI revision; preserve it and use a fresh runtime directory."
        }
    } else {
        if (Test-Path -LiteralPath $RuntimeDir) {
            throw "$RuntimeDir exists but is not a Git checkout; move it aside and retry."
        }
        & $script:GitCommand init $RuntimeDir
        if ($LASTEXITCODE -ne 0) { throw "Could not initialize the PentAGI checkout." }
        & $script:GitCommand -C $RuntimeDir remote add origin $PentagiRepository
        if ($LASTEXITCODE -ne 0) { throw "Could not configure the official PentAGI remote." }
        & $script:GitCommand -C $RuntimeDir fetch --depth 1 origin $PentagiRef
        if ($LASTEXITCODE -ne 0) { throw "Could not download the pinned PentAGI source." }
        & $script:GitCommand -C $RuntimeDir checkout --detach FETCH_HEAD
        if ($LASTEXITCODE -ne 0) { throw "Could not check out the pinned PentAGI source." }
    }

    if (-not (Test-Path -LiteralPath (Join-Path $RuntimeDir "docker-compose.yml"))) {
        throw "PentAGI's Docker Compose file is missing."
    }

    New-Item -ItemType Directory -Force -Path $ModelsDir | Out-Null
    Ensure-Model $ChatModel $ChatModelUrl $ChatModelSha256
    Ensure-Model $EmbedModel $EmbedModelUrl $EmbedModelSha256
    Copy-Item -Force (Join-Path $RootDir "config/llama.cpp.provider.yml") (Join-Path $RuntimeDir "llama.cpp.provider.yml")
    Copy-Item -Force (Join-Path $RootDir "tests/llama-smoke.yml") (Join-Path $RuntimeDir "llama-smoke.yml")

    $EnvPath = Join-Path $RuntimeDir ".env"
    if (-not (Test-Path -LiteralPath $EnvPath)) {
        $Crypto = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        try {
            $CookieBytes = New-Object byte[] 32
            $PasswordBytes = New-Object byte[] 32
            $Crypto.GetBytes($CookieBytes)
            $Crypto.GetBytes($PasswordBytes)
            $CookieSalt = [BitConverter]::ToString($CookieBytes).Replace("-", "").ToLowerInvariant()
            $DatabasePassword = [BitConverter]::ToString($PasswordBytes).Replace("-", "").ToLowerInvariant()
        } finally {
            $Crypto.Dispose()
        }
        @(
            "COOKIE_SIGNING_SALT=$CookieSalt"
            "PENTAGI_POSTGRES_USER=pentagi"
            "PENTAGI_POSTGRES_PASSWORD=$DatabasePassword"
            "PENTAGI_POSTGRES_DB=pentagidb"
            "PENTAGI_LISTEN_IP=127.0.0.1"
            "PENTAGI_LISTEN_PORT=8443"
            "PUBLIC_URL=https://localhost:8443"
            "CORS_ORIGINS=https://localhost:8443"
        ) | Set-Content -Encoding Ascii -LiteralPath $EnvPath
    }

    Invoke-DockerCompose @("config", "--quiet")
}

try {
    switch ($Action) {
        "prepare" {
            Prepare-Runtime
            Write-Host "PentAGI source, local configuration, and model files are ready."
        }
        "start" {
            Prepare-Runtime
            Invoke-DockerCompose @("up", "-d")
            Write-Host "Waiting for PentAGI at https://localhost:8443 ..."
            & $script:CurlCommand --insecure --silent --show-error --fail --retry 120 --retry-connrefused --retry-delay 5 --max-time 5 https://localhost:8443/ *> $null
            if ($LASTEXITCODE -ne 0) {
                throw "PentAGI did not become ready; inspect logs with: .\quick-start.ps1 logs"
            }

            Invoke-DockerCompose @(
                "exec", "-T", "pentagi", "/opt/pentagi/bin/ctester",
                "-env", "/dev/null",
                "-config", "/opt/pentagi/conf/llama.cpp.provider.yml",
                "-tests", "/opt/pentagi/conf/llama-smoke.yml",
                "-agents", "simple", "-groups", "basic", "-workers", "1"
            )
            Invoke-DockerCompose @("exec", "-T", "pentagi", "/opt/pentagi/bin/etester", "-env", "/dev/null", "test")

            Write-Host ""
            Write-Host "PentAGI is ready: https://localhost:8443"
            Write-Host "Sign in with admin@pentagi.com / admin, then change the password immediately."
        }
        "stop" {
            if (-not (Test-Path -LiteralPath (Join-Path $RuntimeDir "docker-compose.yml"))) {
                throw "Quick start has not been initialized."
            }
            Invoke-DockerCompose @("down")
        }
        "status" {
            if (-not (Test-Path -LiteralPath (Join-Path $RuntimeDir "docker-compose.yml"))) {
                throw "Quick start has not been initialized."
            }
            Invoke-DockerCompose @("ps")
        }
        "logs" {
            if (-not (Test-Path -LiteralPath (Join-Path $RuntimeDir "docker-compose.yml"))) {
                throw "Quick start has not been initialized."
            }
            Invoke-DockerCompose @("logs", "--tail", "100")
        }
    }
} catch {
    Write-Error $_
    exit 1
}
