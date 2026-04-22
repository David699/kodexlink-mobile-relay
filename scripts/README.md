# Scripts

- `dev-services.sh`: 启停本地 relay-server 与 mac-agent。
- `check-ubuntu-relay-host.sh`: 检查 Ubuntu relay 主机的基础环境、端口、域名解析和依赖。
- `setup-ubuntu-relay-host.sh`: 初始化 Ubuntu relay 主机、systemd 和 Nginx 站点。
- `generate-swift-message-types.mjs`: 由 `packages/protocol/src/messages.ts` 生成 iOS 协议模型文件。运行：
  - `pnpm protocol:generate:swift`

历史说明：

- 旧的 cert-sync 证书同步链路已于 `2026-03-25` 退役，相关脚本已归档到 `scripts/archive/cert-sync/`。
- 当前 relay 服务器改为在本机使用 `certbot` 管理 `relay.example.com` 证书和自动续期。
