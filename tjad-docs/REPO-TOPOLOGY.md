# 仓库拓扑（2026-10-05 定稿：单一开发仓库）

**本项目全部开发集中在 GitHub fork `zkjshr/cherry-studio` 的 `enterprise` 分支**：

```
cherry-studio/
├── src/…          客户端（企业代码 src/main/enterprise、src/main/marketplace）
├── gateway/       网关（模型代理/企业配置/插件市场/WeKnora MCP，自带 tests/）
├── tjad-docs/     项目文档（本目录：PRD 见 superpowers/specs、计划与执行日志、
│                  内测指南 BETA-GUIDE、上游合并手册 UPSTREAM-SYNC、验收台账 ACCEPTANCE、
│                  企业版调研 research/）
└── scripts/dev-client.sh   一键起企业 dev 实例
```

## 历史/存档仓库（不再开发，仅参考）

| 仓库 | 内容 | 状态 |
|---|---|---|
| NAS `TJADKnows.git`（本地 TJADKnows/desktop） | gateway 冻结副本（7372f39）+ Tauri 桌宠归档 archive/desktop-tauri | 存档 |
| NAS `TJADKnows-docs.git` | 文档历史（并入本仓库 tjad-docs/ 前的版本） | 存档 |

## 日常流程

- 开发 → 提交 → push enterprise（自动触发 GHA Windows 包构建）
- 生产网关更新：`rsync cherry-studio/gateway/ → 服务器 ~/tjad-gateway/gateway/` + `start.sh`
- 预览：`scripts/dev-client.sh`
- 上游合并：按 tjad-docs/UPSTREAM-SYNC.md
- 发包：版本号 package.json `2.1.4-tjad.N` → GHA 出 Windows 包 + 本地 `pnpm build:mac:arm64` → 服务器 /download
