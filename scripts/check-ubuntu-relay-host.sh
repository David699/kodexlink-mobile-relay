#!/usr/bin/env bash
set -euo pipefail

PHASE="preflight"
RELAY_DOMAIN="${RELAY_DOMAIN:-}"
SSL_CERT_PATH="${SSL_CERT_PATH:-}"
SSL_KEY_PATH="${SSL_KEY_PATH:-}"
APP_USER="${APP_USER:-kodexlink}"
APP_DIR="${APP_DIR:-/srv/kodexlink}"
ETC_DIR="${ETC_DIR:-/etc/kodexlink}"
LOG_DIR="${LOG_DIR:-/var/log/kodexlink}"
RELAY_PORT="${RELAY_PORT:-8787}"
DB_NAME="${DB_NAME:-codex_mobile}"
DB_USER="${DB_USER:-kodexlink}"
NODE_MAJOR="${NODE_MAJOR:-24}"
SYSTEMD_UNIT="${SYSTEMD_UNIT:-/etc/systemd/system/kodexlink-relay.service}"
NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-available/kodexlink-relay.conf}"
RELAY_ENV_FILE="${RELAY_ENV_FILE:-${ETC_DIR}/relay.env}"
SSH_UFW_PROFILE="${SSH_UFW_PROFILE:-OpenSSH}"
APP_HOME="${APP_HOME:-/home/${APP_USER}}"
NVM_DIR="${NVM_DIR:-${APP_HOME}/.nvm}"

ERROR_COUNT=0
WARN_COUNT=0

usage() {
  cat <<'EOF'
用法:
  bash scripts/check-ubuntu-relay-host.sh [--phase preflight|postinstall] [--domain relay.example.com] [--ssl-cert-path /path/fullchain.pem] [--ssl-key-path /path/privkey.pem]

说明:
  - preflight: 安装前检查，缺少软件包只提示 warning
  - postinstall: 安装后检查，会额外验证服务、配置文件与目录
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --phase)
      PHASE="${2:-}"
      shift 2
      ;;
    --domain)
      RELAY_DOMAIN="${2:-}"
      shift 2
      ;;
    --ssl-cert-path)
      SSL_CERT_PATH="${2:-}"
      shift 2
      ;;
    --ssl-key-path)
      SSL_KEY_PATH="${2:-}"
      shift 2
      ;;
    --app-user)
      APP_USER="${2:-}"
      shift 2
      ;;
    --app-dir)
      APP_DIR="${2:-}"
      shift 2
      ;;
    --etc-dir)
      ETC_DIR="${2:-}"
      RELAY_ENV_FILE="${ETC_DIR}/relay.env"
      shift 2
      ;;
    --relay-port)
      RELAY_PORT="${2:-}"
      shift 2
      ;;
    --db-name)
      DB_NAME="${2:-}"
      shift 2
      ;;
    --db-user)
      DB_USER="${2:-}"
      shift 2
      ;;
    --node-major)
      NODE_MAJOR="${2:-}"
      shift 2
      ;;
    --systemd-unit)
      SYSTEMD_UNIT="${2:-}"
      shift 2
      ;;
    --nginx-site)
      NGINX_SITE="${2:-}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "[check] 未知参数: $1" >&2
      usage
      exit 1
      ;;
  esac
done

ok() {
  printf '[OK] %s\n' "$1"
}

warn() {
  WARN_COUNT=$((WARN_COUNT + 1))
  printf '[WARN] %s\n' "$1"
}

fail() {
  ERROR_COUNT=$((ERROR_COUNT + 1))
  printf '[ERROR] %s\n' "$1"
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

service_known() {
  systemctl list-unit-files "$1" >/dev/null 2>&1
}

service_state() {
  local unit="$1"
  if ! service_known "${unit}"; then
    printf 'missing'
    return 0
  fi
  systemctl is-active "${unit}" 2>/dev/null || true
}

check_required_command() {
  local name="$1"
  if command_exists "${name}"; then
    ok "命令存在: ${name}"
  else
    fail "缺少必要命令: ${name}"
  fi
}

check_optional_command() {
  local name="$1"
  if command_exists "${name}"; then
    ok "命令存在: ${name}"
  else
    warn "缺少命令: ${name}"
  fi
}

check_package_state() {
  local pkg="$1"
  if dpkg-query -W -f='${Status}' "${pkg}" 2>/dev/null | grep -q "install ok installed"; then
    ok "软件包已安装: ${pkg}"
  else
    if [[ "${PHASE}" == "postinstall" ]]; then
      fail "软件包未安装: ${pkg}"
    else
      warn "软件包未安装: ${pkg}"
    fi
  fi
}

check_file_exists() {
  local path="$1"
  local label="$2"
  if [[ -f "${path}" ]]; then
    ok "${label}存在: ${path}"
  else
    if [[ "${PHASE}" == "postinstall" ]]; then
      fail "${label}不存在: ${path}"
    else
      warn "${label}不存在: ${path}"
    fi
  fi
}

check_dir_exists() {
  local path="$1"
  local label="$2"
  if [[ -d "${path}" ]]; then
    ok "${label}存在: ${path}"
  else
    if [[ "${PHASE}" == "postinstall" ]]; then
      fail "${label}不存在: ${path}"
    else
      warn "${label}不存在: ${path}"
    fi
  fi
}

check_user_command_with_nvm() {
  local user_name="$1"
  local command_name="$2"
  local nvm_dir="$3"
  local output
  output="$(runuser -u "${user_name}" -- /bin/bash -lc "export NVM_DIR='${nvm_dir}'; [ -s \"\$NVM_DIR/nvm.sh\" ] && . \"\$NVM_DIR/nvm.sh\" && command -v ${command_name}" 2>/dev/null || true)"
  if [[ -n "${output}" ]]; then
    ok "用户 ${user_name} 可通过 nvm 使用 ${command_name}: ${output}"
  else
    if [[ "${PHASE}" == "postinstall" ]]; then
      fail "用户 ${user_name} 无法通过 nvm 使用 ${command_name}"
    else
      warn "用户 ${user_name} 暂未通过 nvm 提供 ${command_name}"
    fi
  fi
}

check_port_listener() {
  local port="$1"
  local label="$2"
  local output
  output="$(ss -ltnp "( sport = :${port} )" 2>/dev/null | tail -n +2 || true)"
  if [[ -n "${output}" ]]; then
    ok "${label}端口 ${port} 有监听"
    printf '%s\n' "${output}" | sed 's/^/[INFO] /'
  else
    if [[ "${PHASE}" == "postinstall" && ( "${port}" == "80" || "${port}" == "443" || "${port}" == "${RELAY_PORT}" ) ]]; then
      warn "${label}端口 ${port} 当前没有监听"
    else
      warn "${label}端口 ${port} 当前没有监听"
    fi
  fi
}

echo "[check] 阶段: ${PHASE}"

if [[ ! -f /etc/os-release ]]; then
  fail "缺少 /etc/os-release，无法识别系统"
else
  # shellcheck disable=SC1091
  source /etc/os-release
  if [[ "${ID:-}" == "ubuntu" ]]; then
    ok "操作系统: Ubuntu ${VERSION_ID:-unknown}"
  else
    fail "当前系统不是 Ubuntu: ${ID:-unknown}"
  fi

  if [[ -n "${VERSION_ID:-}" ]] && dpkg --compare-versions "${VERSION_ID}" ge "20.04"; then
    ok "Ubuntu 版本满足 >= 20.04"
  else
    fail "Ubuntu 版本过低: ${VERSION_ID:-unknown}"
  fi
fi

case "$(uname -m)" in
  x86_64|amd64)
    ok "CPU 架构满足 x64"
    ;;
  *)
    fail "不支持的 CPU 架构: $(uname -m)"
    ;;
esac

if command_exists systemctl; then
  ok "systemd 可用"
else
  fail "systemd 不可用"
fi

check_required_command apt-get
check_required_command dpkg
check_required_command bash
check_required_command ss

memory_mb="$(awk '/MemTotal/ {printf "%.0f", $2 / 1024}' /proc/meminfo)"
if [[ "${memory_mb}" -ge 2048 ]]; then
  ok "内存充足: ${memory_mb} MB"
else
  warn "内存较低: ${memory_mb} MB，建议至少 2048 MB"
fi

disk_mb="$(df -Pm / | awk 'NR==2 {print $4}')"
if [[ "${disk_mb}" -ge 10240 ]]; then
  ok "磁盘剩余空间充足: ${disk_mb} MB"
else
  warn "磁盘剩余空间较低: ${disk_mb} MB，建议至少 10240 MB"
fi

if [[ -n "${RELAY_DOMAIN}" ]]; then
  ok "已提供域名: ${RELAY_DOMAIN}"
  if getent ahosts "${RELAY_DOMAIN}" >/dev/null 2>&1; then
    ok "域名可解析: ${RELAY_DOMAIN}"
  else
    warn "域名暂未解析: ${RELAY_DOMAIN}"
  fi
else
  warn "未提供 RELAY_DOMAIN / --domain"
fi

if [[ -n "${SSL_CERT_PATH}" ]]; then
  check_file_exists "${SSL_CERT_PATH}" "证书文件"
else
  warn "未提供 SSL_CERT_PATH / --ssl-cert-path"
fi

if [[ -n "${SSL_KEY_PATH}" ]]; then
  check_file_exists "${SSL_KEY_PATH}" "证书私钥"
else
  warn "未提供 SSL_KEY_PATH / --ssl-key-path"
fi

check_optional_command curl
check_optional_command git
check_optional_command openssl
check_optional_command nginx
check_optional_command psql
check_optional_command pg_isready
check_optional_command redis-server
check_optional_command redis-cli
check_optional_command node
check_optional_command pnpm
check_optional_command ufw

check_package_state nginx
check_package_state postgresql
check_package_state redis-server

if command_exists node; then
  ok "Node.js 版本: $(node -v)"
fi

if command_exists pnpm; then
  ok "pnpm 版本: $(pnpm -v)"
fi

check_port_listener 80 "HTTP"
check_port_listener 443 "HTTPS"
check_port_listener "${RELAY_PORT}" "Relay"
check_port_listener 5432 "PostgreSQL"
check_port_listener 6379 "Redis"

if command_exists ufw; then
  if [[ "${EUID}" -eq 0 ]]; then
    ufw_status="$(ufw status 2>/dev/null | head -n 1 || true)"
    if [[ -n "${ufw_status}" ]]; then
      ok "UFW 状态: ${ufw_status}"
    else
      warn "UFW 状态读取失败"
    fi
  else
    warn "非 root 运行，跳过 UFW 状态检查"
  fi
fi

if [[ "${PHASE}" == "postinstall" ]]; then
  check_dir_exists "${APP_DIR}" "应用目录"
  check_dir_exists "${ETC_DIR}" "配置目录"
  check_dir_exists "${LOG_DIR}" "日志目录"
  check_file_exists "${RELAY_ENV_FILE}" "Relay env 文件"
  check_file_exists "${SYSTEMD_UNIT}" "systemd unit"
  check_file_exists "${NGINX_SITE}" "Nginx 站点配置"

  if id "${APP_USER}" >/dev/null 2>&1; then
    ok "系统用户存在: ${APP_USER}"
  else
    fail "系统用户不存在: ${APP_USER}"
  fi

  check_dir_exists "${NVM_DIR}" "nvm 目录"
  check_file_exists "${NVM_DIR}/nvm.sh" "nvm 初始化脚本"
  check_user_command_with_nvm "${APP_USER}" node "${NVM_DIR}"
  check_user_command_with_nvm "${APP_USER}" pnpm "${NVM_DIR}"

  nginx_state="$(service_state nginx.service)"
  case "${nginx_state}" in
    active)
      ok "Nginx 服务已启动"
      ;;
    missing)
      fail "Nginx 服务不存在"
      ;;
    *)
      fail "Nginx 服务未启动: ${nginx_state}"
      ;;
  esac

  pg_state="$(service_state postgresql.service)"
  case "${pg_state}" in
    active)
      ok "PostgreSQL 服务已启动"
      ;;
    missing)
      fail "PostgreSQL 服务不存在"
      ;;
    *)
      fail "PostgreSQL 服务未启动: ${pg_state}"
      ;;
  esac

  redis_state="$(service_state redis-server.service)"
  case "${redis_state}" in
    active)
      ok "Redis 服务已启动"
      ;;
    missing)
      fail "Redis 服务不存在"
      ;;
    *)
      fail "Redis 服务未启动: ${redis_state}"
      ;;
  esac

  if command_exists pg_isready; then
    if pg_isready -q; then
      ok "PostgreSQL 可连通"
    else
      fail "PostgreSQL 未通过 pg_isready 检查"
    fi
  fi

  if command_exists redis-cli; then
    if redis-cli ping 2>/dev/null | grep -q '^PONG$'; then
      ok "Redis 可连通"
    else
      fail "Redis 未通过 redis-cli ping 检查"
    fi
  fi

  if [[ -f "${RELAY_ENV_FILE}" ]]; then
    if grep -q "^DATABASE_URL=postgres://" "${RELAY_ENV_FILE}" && grep -q "^REDIS_URL=redis://" "${RELAY_ENV_FILE}"; then
      ok "Relay env 文件包含数据库与 Redis 配置"
    else
      fail "Relay env 文件缺少 DATABASE_URL 或 REDIS_URL"
    fi
  fi
fi

printf '[check] 完成，error=%d warning=%d\n' "${ERROR_COUNT}" "${WARN_COUNT}"

if [[ "${ERROR_COUNT}" -gt 0 ]]; then
  exit 1
fi
