#!/usr/bin/env bash
set -euo pipefail

CONFIG_PATH="${CONFIG_PATH:-/etc/kodexlink/cert-sync.env}"
if [[ -f "${CONFIG_PATH}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${CONFIG_PATH}"
  set +a
fi

SOURCE_HOST="${SOURCE_HOST:-my-muffin.top}"
SOURCE_PORT="${SOURCE_PORT:-22}"
SOURCE_USER="${SOURCE_USER:-root}"
SOURCE_CERT_DIR="${SOURCE_CERT_DIR:-/root/testPemDir}"
SOURCE_FULLCHAIN_PATH="${SOURCE_FULLCHAIN_PATH:-${SOURCE_CERT_DIR}/fullchain.pem}"
SOURCE_PRIVKEY_PATH="${SOURCE_PRIVKEY_PATH:-${SOURCE_CERT_DIR}/privkey.pem}"
SOURCE_SSH_PASSWORD="${SOURCE_SSH_PASSWORD:-}"

LOCAL_CERT_DIR="${LOCAL_CERT_DIR:-/etc/kodexlink/tls}"
LOCAL_FULLCHAIN_PATH="${LOCAL_FULLCHAIN_PATH:-${LOCAL_CERT_DIR}/fullchain.pem}"
LOCAL_PRIVKEY_PATH="${LOCAL_PRIVKEY_PATH:-${LOCAL_CERT_DIR}/privkey.pem}"

KNOWN_HOSTS_FILE="${KNOWN_HOSTS_FILE:-/root/.ssh/known_hosts}"
MIN_DAYS_LEFT="${MIN_DAYS_LEFT:-15}"
AUTO_INSTALL_SSHPASS="${AUTO_INSTALL_SSHPASS:-1}"
FORCE_SYNC="${FORCE_SYNC:-0}"
SERVICE_RELOAD_CMD="${SERVICE_RELOAD_CMD:-nginx -t && systemctl reload nginx}"

TMP_DIR=""

log() {
  printf '[cert-sync] %s\n' "$1"
}

fail() {
  printf '[cert-sync][ERROR] %s\n' "$1" >&2
  exit 1
}

cleanup() {
  if [[ -n "${TMP_DIR}" && -d "${TMP_DIR}" ]]; then
    rm -rf "${TMP_DIR}"
  fi
}

trap cleanup EXIT

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    fail "请使用 root 运行证书同步脚本"
  fi
}

ensure_command() {
  local name="$1"
  command -v "${name}" >/dev/null 2>&1 || fail "缺少命令: ${name}"
}

ensure_sshpass() {
  if command -v sshpass >/dev/null 2>&1; then
    return 0
  fi

  if [[ "${AUTO_INSTALL_SSHPASS}" != "1" ]]; then
    fail "缺少 sshpass，且 AUTO_INSTALL_SSHPASS != 1"
  fi

  ensure_command apt-get
  log "检测到缺少 sshpass，开始自动安装"
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y sshpass
}

ensure_runtime() {
  require_root
  ensure_command openssl
  ensure_command scp
  ensure_command ssh
  ensure_command install
  ensure_sshpass

  [[ -n "${SOURCE_SSH_PASSWORD}" ]] || fail "缺少 SOURCE_SSH_PASSWORD，请在 ${CONFIG_PATH} 或环境变量中提供"
  [[ "${MIN_DAYS_LEFT}" =~ ^[0-9]+$ ]] || fail "MIN_DAYS_LEFT 必须是非负整数"

  mkdir -p "${LOCAL_CERT_DIR}" "$(dirname "${KNOWN_HOSTS_FILE}")"
}

cert_expiry_timestamp() {
  local cert_path="$1"
  local expiry_date
  expiry_date="$(openssl x509 -enddate -noout -in "${cert_path}" | cut -d= -f2)"
  date -d "${expiry_date}" +%s
}

cert_days_left() {
  local cert_path="$1"
  local expiry_ts current_ts
  expiry_ts="$(cert_expiry_timestamp "${cert_path}")"
  current_ts="$(date +%s)"
  printf '%s\n' "$(( (expiry_ts - current_ts) / 86400 ))"
}

cert_pubkey_sha256() {
  local cert_path="$1"
  openssl x509 -in "${cert_path}" -pubkey -noout \
    | openssl pkey -pubin -outform der 2>/dev/null \
    | openssl dgst -sha256 \
    | awk '{print $2}'
}

key_pubkey_sha256() {
  local key_path="$1"
  openssl pkey -in "${key_path}" -pubout -outform der 2>/dev/null \
    | openssl dgst -sha256 \
    | awk '{print $2}'
}

validate_cert_pair() {
  local cert_path="$1"
  local key_path="$2"
  local cert_sha key_sha

  openssl x509 -noout -in "${cert_path}" >/dev/null 2>&1 || fail "证书文件无效: ${cert_path}"
  openssl pkey -in "${key_path}" -noout >/dev/null 2>&1 || fail "私钥文件无效: ${key_path}"

  cert_sha="$(cert_pubkey_sha256 "${cert_path}")"
  key_sha="$(key_pubkey_sha256 "${key_path}")"
  [[ -n "${cert_sha}" && -n "${key_sha}" ]] || fail "无法计算证书或私钥指纹"
  [[ "${cert_sha}" == "${key_sha}" ]] || fail "证书与私钥不匹配"
}

fetch_remote_files() {
  TMP_DIR="$(mktemp -d /tmp/kodexlink-cert-sync.XXXXXX)"
  export SSHPASS="${SOURCE_SSH_PASSWORD}"

  local scp_opts=(
    -P "${SOURCE_PORT}"
    -o StrictHostKeyChecking=accept-new
    -o UserKnownHostsFile="${KNOWN_HOSTS_FILE}"
  )

  log "从 ${SOURCE_USER}@${SOURCE_HOST} 拉取证书文件"
  sshpass -e scp "${scp_opts[@]}" \
    "${SOURCE_USER}@${SOURCE_HOST}:${SOURCE_FULLCHAIN_PATH}" \
    "${TMP_DIR}/fullchain.pem"
  sshpass -e scp "${scp_opts[@]}" \
    "${SOURCE_USER}@${SOURCE_HOST}:${SOURCE_PRIVKEY_PATH}" \
    "${TMP_DIR}/privkey.pem"

  validate_cert_pair "${TMP_DIR}/fullchain.pem" "${TMP_DIR}/privkey.pem"
}

install_local_files() {
  install -m 0644 "${TMP_DIR}/fullchain.pem" "${LOCAL_FULLCHAIN_PATH}"
  install -m 0600 "${TMP_DIR}/privkey.pem" "${LOCAL_PRIVKEY_PATH}"

  log "执行服务重载命令"
  bash -lc "${SERVICE_RELOAD_CMD}"
}

main() {
  ensure_runtime
  fetch_remote_files

  local remote_days_left remote_fingerprint
  remote_days_left="$(cert_days_left "${TMP_DIR}/fullchain.pem")"
  remote_fingerprint="$(cert_pubkey_sha256 "${TMP_DIR}/fullchain.pem")"
  log "源证书剩余天数: ${remote_days_left}"

  if [[ "${FORCE_SYNC}" == "1" ]]; then
    log "FORCE_SYNC=1，强制覆盖本地证书"
    install_local_files
    return 0
  fi

  if [[ ! -f "${LOCAL_FULLCHAIN_PATH}" || ! -f "${LOCAL_PRIVKEY_PATH}" ]]; then
    log "本地证书不存在，开始安装"
    install_local_files
    return 0
  fi

  validate_cert_pair "${LOCAL_FULLCHAIN_PATH}" "${LOCAL_PRIVKEY_PATH}"

  local local_days_left local_fingerprint
  local_days_left="$(cert_days_left "${LOCAL_FULLCHAIN_PATH}")"
  local_fingerprint="$(cert_pubkey_sha256 "${LOCAL_FULLCHAIN_PATH}")"

  log "本地证书剩余天数: ${local_days_left}"

  if [[ "${remote_fingerprint}" != "${local_fingerprint}" ]]; then
    log "检测到源证书已更新，开始覆盖本地证书"
    install_local_files
    return 0
  fi

  if (( local_days_left <= MIN_DAYS_LEFT )); then
    log "本地证书剩余 ${local_days_left} 天，已达到阈值 ${MIN_DAYS_LEFT} 天"
    if (( remote_days_left > local_days_left )); then
      log "源证书更新更晚，开始覆盖本地证书"
      install_local_files
      return 0
    fi
    log "源证书与本地证书一致，暂不覆盖，等待源机器完成续签"
    return 0
  fi

  log "本地证书仍有效，且源证书未变化，无需更新"
}

main "$@"
