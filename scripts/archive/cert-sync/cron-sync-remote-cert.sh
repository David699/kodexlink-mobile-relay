#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_PATH="${CONFIG_PATH:-/etc/kodexlink/cert-sync.env}"
SYNC_SCRIPT="${SYNC_SCRIPT:-${SCRIPT_DIR}/sync-remote-cert.sh}"
LOCK_FILE="${LOCK_FILE:-/var/run/kodexlink-cert-sync.lock}"
LOG_DIR="${LOG_DIR:-/var/log/kodexlink}"
LOG_FILE="${LOG_FILE:-${LOG_DIR}/cert-sync.log}"

if [[ -f "${CONFIG_PATH}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${CONFIG_PATH}"
  set +a
fi

mkdir -p "${LOG_DIR}" "$(dirname "${LOCK_FILE}")"
touch "${LOG_FILE}"

exec >>"${LOG_FILE}" 2>&1

printf '[cert-sync-cron] %s start\n' "$(date '+%Y-%m-%d %H:%M:%S')"

if ! command -v flock >/dev/null 2>&1; then
  printf '[cert-sync-cron][ERROR] flock 不存在，无法安全执行定时任务\n'
  exit 1
fi

if [[ ! -x "${SYNC_SCRIPT}" ]]; then
  printf '[cert-sync-cron][ERROR] 同步脚本不存在或不可执行: %s\n' "${SYNC_SCRIPT}"
  exit 1
fi

exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  printf '[cert-sync-cron] 检测到已有同步任务正在运行，跳过本次执行\n'
  exit 0
fi

CONFIG_PATH="${CONFIG_PATH}" "${SYNC_SCRIPT}"
printf '[cert-sync-cron] %s finished\n' "$(date '+%Y-%m-%d %H:%M:%S')"
