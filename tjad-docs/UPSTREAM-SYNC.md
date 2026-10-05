# 上游同步手册（cherry-studio fork）

- 我们的分支：`zkjshr/cherry-studio` 的 **`enterprise`**（企业版唯一开发线）
- 上游：`CherryHQ/cherry-studio` 的 `main`
- 原则：**上游更新永远不主动影响我们；合并是我们主动、择时的动作**

## 一、什么时候合并

| 信号 | 动作 |
|---|---|
| 季度节点到了（上次合并已 ~3 个月） | 例行合并，拖越久冲突越大 |
| 上游出了我们急需的功能/修复 | 随时合并（先看 release notes） |
| 上游有安全公告 | 尽快合并 |
| 内测周/正在发包 | 错开，合并单独排期 |

## 二、合并 SOP（对我说"合并上游"即可，全程我来）

```bash
cd /Volumes/MacSSD/Library/VibeCoding/cherry-studio
git fetch upstream
git checkout enterprise
git merge upstream/main
# ↓ 冲突逐个裁决（原则见下）
pnpm typecheck                                   # 门禁 1
pnpm vitest run src/main/enterprise src/main/marketplace  # 门禁 2
# dev 实例冒烟（scripts/dev-client.sh），确认企业功能齐全
git push origin enterprise       # 自动触发 GHA 出 Windows 包
# 出包后 mac 本地构建 + 三包上服务器（标准发布流程）
```

## 三、冲突裁决原则

1. `src/main/enterprise/`、`src/main/marketplace/`：**全保 ours**（上游没有这些目录，理论上无冲突）
2. 品牌文案（语言包、错误串、窗口标题）：**保 ours**（"TJADKnows Desktop"）
3. 上游新功能/重构（providers、chat、MCP 等我们没改过的区域）：**取 theirs**
4. 我们改过 + 上游也改过的文件（见下清单）：逐处判断，通常是"上游新逻辑 + 我们的托管/品牌适配"两者都要
5. 拿不准的：标记后单独过一遍，宁可不合完

### 我们动过上游文件清单（冲突高发区，合并时重点看）

- 注册点：`serviceRegistry.ts`、`src/main/ipc.ts`、`src/preload/preload.ts`、`src/shared/IpcChannel.ts`
- 行为改造：`AppUpdaterService.ts`（企业禁更新）、`v2MigrationGate.ts`（企业跳过迁移门）
- UI 挂载：`sidebar.ts`（市场入口）、`AboutSettings`、`GeneralSettings/EnterpriseSettingsCard`、市场页路由
- 品牌：13 个语言包、若干错误文案文件、各窗口 `index.html`
- 资源：`resources/enterprise.default.json`

## 四、禁忌

- ❌ GitHub fork 页面对 `enterprise` 分支点 **Sync fork → Discard commits**（这是唯一真正"覆盖"的路径）
- ❌ 对 `enterprise` 做 force push（本地/CI 包会错乱）
- ❌ 合并未过门禁就发包
- ❌ 直接在 fork 的 `main` 上开发任何东西（main 只是上游镜像）

## 五、出问题怎么办

- 合并后发现问题：`git revert -m 1 <merge-commit>` 回退合并，重新发包即可；已发到服务器的安装包不受影响
- 想放弃一次合并：`git merge --abort`（未提交时）
- 任何时候 `enterprise` 分支的最新好版本都可用 tag 找回（发包时建议打 `tjad-vX.Y.Z` tag，从现在开始执行）
