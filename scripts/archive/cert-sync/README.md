# Legacy Cert Sync

这些文件是旧的证书同步链路归档，保留仅用于历史排查和回看：

- `sync-remote-cert.sh`
- `cron-sync-remote-cert.sh`
- `cert-sync.env.example`

该链路已于 `2026-03-25` 退役。当前 KodexLink relay 主机不再从其他服务器拉取证书，而是在本机使用 `certbot` 管理 `relay.example.com` 的证书和自动续期。

除非是在排查历史部署，不要再把这里的文件恢复为当前生产方案。
