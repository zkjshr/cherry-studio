# TJADKnows M2 设计文档：桌宠主入口（Pet Companion）

日期：2026-09-28 ｜ 状态：待用户评审
方向调整（用户确认）：桌面替代层（organizer）暂时搁置；**桌宠对话与功能成为主交互入口**；Windows 10/11 优先，mac 保持可编译不重点验收，放弃 Win7 约束（WebView2 Evergreen，vite target 升级，既有 @supports 降级保留无害）。

## 1. 目标与非目标

**目标**
- 常驻桌面的 2D 桌宠：透明置顶小窗 + 帧动画状态机（idle/thinking/talking/dragged）+ 动态点击穿透（宠物本体可交互、周围穿透）+ 左键拖拽移动（位置记忆）。
- 点击宠物弹出**自绘对话面板**：知识库问答（RAG）**流式输出**——网关 SSE 流；先逐行推送"思考过程"（检索状态：查哪些库→命中 N 篇→正在阅读哪几篇），后逐 token 推送回答正文；thinking 阶段与生成阶段桌宠持续播 thinking/talking 动画；回答完成后来源 chips 淡入。
- 右键宠物弹**功能菜单**：呼出检索、设置、（organizer 开启时）整理模式、退出。
- 网关新增 `GET /api/chat/stream`（SSE）：hybrid-search 检索 → 内网 ollama（**流式** `/api/chat stream:true`）生成 → 逐事件推送。
- 配置扩展：`petEnabled`(默认 true)、`petX/petY`、`organizerEnabled`(默认 false，控制 organizer 热键与托盘项)。

**非目标（v1）**
- 多轮深上下文（前端传最近 4 轮，网关无状态）；Live2D/3D、拖拽文件给桌宠入库（M3）、语音、agent/组织架构问答
- WeKnora 原生聊天接口（实测 404，前后端版本不配套——不对其做依赖）
- 思考过程的"真实性"保证：检索状态行来自网关真实检索阶段（可信），生成阶段不再伪造过程文本

## 2. 对话后端：网关编排 RAG + SSE 流（已实测可行）

```
GET /api/chat/stream?q=<query>&history=<urlencoded JSON ≤4轮>   （Bearer 鉴权）
SSE 事件序列（event: 类型 + data: JSON）：
  1. event: status   data: {"text": "正在检索 12 个部门知识库…"}        ← 检索阶段真实状态
  2. event: status   data: {"text": "命中 8 篇相关文档，正在阅读…"}
  3. event: sources  data: {"sources": [{id,kb_id,kb_name,title}≤8]}     ← 先推来源（面板可先渲染 chips 占位/计数）
  4. event: delta    data: {"text": "…"}                                  ← ollama 流式 token（逐个或小批推送）
  ...（delta 多次）
  5. event: done     data: {"partial": false}
  失败：event: error data: {"message": "..."}（任意阶段）；ollama 失败降级：sources 后直接 done+partial:true（前端展示检索型回答=已推的 sources 列表）
网关实现：
  - 检索复用 deep 扇出逻辑（订阅库并发8、3s/库预算、top 8 块去重）——检索前后推 status 行
  - prompt：系统提示（企业知识助手，基于资料回答，答案末尾不需要罗列来源——前端已展示）+ 检索块 + history + query
  - ollama：POST {OLLAMA_BASE_URL}/api/chat {model, stream:true}，读 NDJSON 流逐行解析 message.content 追加为 delta 事件
  - 客户端断开（面板关闭）→ 取消 ollama 请求（httpx stream 断开传播）
网关 env 新增：OLLAMA_BASE_URL（默认 http://192.168.66.25:11434）、OLLAMA_MODEL（默认 gemma4:26b，实测在线）
```

已实测依据：hybrid-search 返回真实语义结果（80 条/库，网关截断）；ollama 192.168.66.25:11434 可达（gemma4:26b 在线，`/api/chat` 支持 stream:true——ollama 原生 NDJSON 流）。

## 3. 桌宠客户端

**窗口（Rust）**：独立 `pet` 窗口（透明、无边框、置顶、skip_taskbar、约 200×240），启动时按 `petX/petY` 恢复位置（默认屏幕右下角）。**动态穿透**：默认 `set_ignore_cursor_events(true)`，前端在宠物本体 `mouseenter`→invoke `set_pet_interactive(true)` / `mouseleave`→false（Rust 切 `set_ignore_cursor_events`）。拖拽：左键按住宠物拖动，松开时 invoke `save_pet_position(x,y)` 写配置。

**渲染（前端）**：开源 **CC0** 2D 素材帧动画（执行时下载 Kenney CC0 动物素材或等价并记录出处；若无合适素材则以程序绘制简约宠物占位——`PetSkin` 组件抽象，素材可后换）。状态机：`idle`（待机循环）、`thinking`（思考中——**检索+生成全程播放**）、`talking`（回复呈现）、`dragged`。点击宠物 ⇄ 切换对话面板显隐。

**对话面板 UI**：约 320×440 毛玻璃深色卡（宠物侧弹出），自上而下：
- 消息气泡列表（用户右/AI 左）
- AI 消息内部两段式：**思考过程区**（等宽小字号逐行 status 文本，浅色，完成后折叠为一行"已检索 N 篇"可展开）→ **回答区**（delta 逐段追加，光标闪烁）
- 回答完成后来源 chips（≤8）淡入（点击走 open_knowledge 同款库页落点）
- 底部输入框+发送（Enter 发送）。流式中再次 Enter=排队/忽略（v1 忽略）。网关不可达：气泡错误提示可重试。

**菜单**：右键宠物 → 自绘小菜单（毛玻璃列表项：呼出检索/整理模式*/设置/退出；*仅 organizerEnabled）。托盘菜单同步加"显示/隐藏桌宠"。

**organizer 挂起方式**：`organizerEnabled=false`（默认）时不注册 Alt+D、托盘不出"整理模式"项、不创建 organizer 窗口；代码全保留，配置改 true 即恢复。

## 4. 降级与错误

| 情况 | 行为 |
|---|---|
| 网关不可达 | 对话气泡错误提示+重试；桌宠本体与菜单不受影响 |
| ollama 不可达/流中断（>30s 首 token） | 已推 sources 则降级检索型回答（chips 列表即答案）+ done partial:true；未开始生成则 error 事件 |
| hybrid-search 全部超时 | status 行如实显示"知识库暂不可达"，ollama 仅凭 history 回答或提示重试 |
| 素材加载失败 | 程序绘制占位宠物 |
| 流式中关闭面板 | 前端 abort，网关断开传播取消 ollama |

## 5. 验收（Windows 10/11 真机为主）

- 桌宠穿透：宠物可点、宠物外区域点击穿透到下层窗口；拖拽移动顺畅、重启位置记忆
- 对话：真实 KB 问答（如"资质相关通知"）返回带引用回答；断网关/断 ollama 降级正确
- 菜单/托盘：右键菜单四项功能正确；organizerEnabled=false 时无整理模式入口
- 打包：nsis 安装包（**需 Windows 机器或 CI 构建——待办**）；开机自启后桌宠自动出现
- 资源：桌宠+对话面板常驻 <200MB
- mac：cargo check + dev 冒烟保持可编译

## 6. 待办与开放项

1. CC0 素材选型与下载（记录出处与授权）
2. ollama 模型确认：gemma4:26b 中文问答质量抽查；备选 qwen 系列
3. Windows nsis 构建通道（用户 Windows 机 或 GitHub Actions）
4. `windows.rs` 的 launcher 定位逻辑与 pet 位置记忆的坐标单位统一（物理像素）
