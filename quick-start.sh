#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
RUNTIME_DIR="$ROOT_DIR/.runtime/pentagi"
MODELS_DIR="$RUNTIME_DIR/models"
PENTAGI_REF="843dfeb4bfc809c09d1bc5022e567c602d8fc9dd"
PENTAGI_REPOSITORY="https://github.com/vxcontrol/pentagi.git"
CHAT_MODEL="G9v3-3B-Heretic-Abliterated-Q8_0.gguf"
CHAT_MODEL_URL="https://huggingface.co/Vortecks/G9v3-3B-Heretic-Abliterated-GGUF/resolve/09c854e0787d56f8482433e6973a04d94f9087b1/$CHAT_MODEL"
CHAT_MODEL_SHA256="405ac09db37cb6f4c3edb4dcff9d5b8c4b10b1a57c5575fdaeb07617b5032de8"
EMBED_MODEL="nomic-embed-text-v1.5.Q4_K_M.gguf"
EMBED_MODEL_URL="https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/0188c9bf409793f810680a5a431e7b899c46104c/$EMBED_MODEL"
EMBED_MODEL_SHA256="d4e388894e09cf3816e8b0896d81d265b55e7a9fff9ab03fe8bf4ef5e11295ac"
ACTION="${1:-start}"

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    fail "Install sha256sum or shasum to verify downloaded model files."
  fi
}

compose() {
  docker compose \
    --project-directory "$RUNTIME_DIR" \
    --env-file "$RUNTIME_DIR/.env" \
    -f "$RUNTIME_DIR/docker-compose.yml" \
    -f "$ROOT_DIR/docker-compose.llama.yml" \
    "$@"
}

ensure_pentagi_source() {
  if [ -d "$RUNTIME_DIR/.git" ]; then
    local origin revision
    origin="$(git -C "$RUNTIME_DIR" remote get-url origin)"
    revision="$(git -C "$RUNTIME_DIR" rev-parse HEAD)"
    [ "$origin" = "$PENTAGI_REPOSITORY" ] || fail "$RUNTIME_DIR is not the official PentAGI checkout."
    [ "$revision" = "$PENTAGI_REF" ] || fail "$RUNTIME_DIR is at an unexpected revision; preserve it and use a fresh runtime directory."
  else
    [ ! -e "$RUNTIME_DIR" ] || fail "$RUNTIME_DIR exists but is not a Git checkout; move it aside and retry."
    git init "$RUNTIME_DIR"
    git -C "$RUNTIME_DIR" remote add origin "$PENTAGI_REPOSITORY"
    git -C "$RUNTIME_DIR" fetch --depth 1 origin "$PENTAGI_REF"
    git -C "$RUNTIME_DIR" checkout --detach FETCH_HEAD
  fi

  [ -f "$RUNTIME_DIR/docker-compose.yml" ] || fail "PentAGI's Docker Compose file is missing."
}

ensure_model() {
  local filename="$1" url="$2" expected="$3" destination="$MODELS_DIR/$1" partial="$MODELS_DIR/$1.part"
  if [ -f "$destination" ]; then
    local actual
    actual="$(sha256_file "$destination")"
    [ "$actual" = "$expected" ] || fail "Checksum mismatch for $filename; the existing file was left untouched."
    return
  fi

  printf 'Downloading %s (first run only)...\n' "$filename"
  if ! curl --fail --location --retry 3 --progress-bar --output "$partial" "$url"; then
    rm -f "$partial"
    fail "Download failed for $filename."
  fi

  local actual
  actual="$(sha256_file "$partial")"
  if [ "$actual" != "$expected" ]; then
    rm -f "$partial"
    fail "Checksum mismatch for downloaded $filename."
  fi
  mv "$partial" "$destination"
}

prepare_runtime() {
  require_command git
  require_command docker
  require_command curl
  docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required."
  docker info >/dev/null 2>&1 || fail "Start Docker Desktop or the Docker Engine, then rerun this command."

  mkdir -p "$(dirname "$RUNTIME_DIR")"
  ensure_pentagi_source
  mkdir -p "$MODELS_DIR"
  ensure_model "$CHAT_MODEL" "$CHAT_MODEL_URL" "$CHAT_MODEL_SHA256"
  ensure_model "$EMBED_MODEL" "$EMBED_MODEL_URL" "$EMBED_MODEL_SHA256"
  cp "$ROOT_DIR/config/llama.cpp.provider.yml" "$RUNTIME_DIR/llama.cpp.provider.yml"
  cp "$ROOT_DIR/tests/llama-smoke.yml" "$RUNTIME_DIR/llama-smoke.yml"

  if [ ! -f "$RUNTIME_DIR/.env" ]; then
    require_command openssl
    umask 077
    {
      printf 'COOKIE_SIGNING_SALT=%s\n' "$(openssl rand -hex 32)"
      printf 'PENTAGI_POSTGRES_USER=pentagi\n'
      printf 'PENTAGI_POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 32)"
      printf 'PENTAGI_POSTGRES_DB=pentagidb\n'
      printf 'PENTAGI_LISTEN_IP=127.0.0.1\n'
      printf 'PENTAGI_LISTEN_PORT=8443\n'
      printf 'PUBLIC_URL=https://localhost:8443\n'
      printf 'CORS_ORIGINS=https://localhost:8443\n'
    } > "$RUNTIME_DIR/.env"
    chmod 600 "$RUNTIME_DIR/.env"
  fi

  compose config --quiet || fail "Docker Compose configuration is invalid."
}

case "$ACTION" in
  prepare)
    prepare_runtime
    printf 'PentAGI source, local configuration, and model files are ready.\n'
    ;;
  start)
    prepare_runtime
    compose up -d
    printf 'Waiting for PentAGI at https://localhost:8443 ...\n'
    curl --insecure --silent --show-error --fail \
      --retry 120 --retry-connrefused --retry-delay 5 --max-time 5 \
      https://localhost:8443/ >/dev/null || fail "PentAGI did not become ready; inspect logs with: bash ./quick-start.sh logs"

    compose exec -T pentagi /opt/pentagi/bin/ctester \
      -env /dev/null \
      -config /opt/pentagi/conf/llama.cpp.provider.yml \
      -tests /opt/pentagi/conf/llama-smoke.yml \
      -agents simple -groups basic -workers 1
    compose exec -T pentagi /opt/pentagi/bin/etester -env /dev/null test

    printf '\nPentAGI is ready: https://localhost:8443\n'
    printf 'Sign in with admin@pentagi.com / admin, then change the password immediately.\n'
    ;;
  stop)
    [ -f "$RUNTIME_DIR/docker-compose.yml" ] || fail "Quick start has not been initialized."
    compose down
    ;;
  status)
    [ -f "$RUNTIME_DIR/docker-compose.yml" ] || fail "Quick start has not been initialized."
    compose ps
    ;;
  logs)
    [ -f "$RUNTIME_DIR/docker-compose.yml" ] || fail "Quick start has not been initialized."
    compose logs --tail 100
    ;;
  *)
    printf 'Usage: %s [prepare|start|stop|status|logs]\n' "$0" >&2
    exit 2
    ;;
esac
