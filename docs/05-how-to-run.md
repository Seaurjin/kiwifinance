# Kiwi Finance — 如何运行与测试

> 版本 v0.1 · 2026-09 · 分支 `claude/kiwi-finance-research-plan-9tnwgk`

这份文档只回答一件事：**拿到这个仓库之后，怎么把它跑起来看到东西。**

网页版 5 分钟能看到结果，不需要任何 API key。iOS 需要一台装了 Xcode 的 Mac，并且要先手动在 Xcode 里接一次原生扩展。

---

## 0. 前置条件

| | 要求 | 检查方式 |
|---|---|---|
| Node | **22 或以上**（后端用了 Node 内置 SQLite，低版本跑不起来） | `node -v` |
| pnpm | 任意近期版本 | `pnpm -v`，没有就 `npm i -g pnpm` |
| Xcode | 只有做 iOS 才需要，16 或以上 | `xcodebuild -version` |

**不需要**：任何 AI 服务的 API key、数据库、Docker、账号注册。提取功能走的是内置的确定性解析器（见下文），整条捕获链路离线可用。

---

## 1. 拉代码

```bash
git clone https://github.com/Seaurjin/kiwifinance
cd kiwifinance
git checkout claude/kiwi-finance-research-plan-9tnwgk   # 内容只在这个分支，main 上没有
pnpm install
```

---

## 2. 网页版

开**两个终端**：

```bash
# 终端 1 —— 后端 API
pnpm dev          # http://localhost:8787，启动时自动灌入演示数据

# 终端 2 —— 网页
pnpm dev:web      # http://localhost:5173
```

浏览器打开 <http://localhost:5173>。

### 值得挨个点一遍的

| 位置 | 看什么 |
|---|---|
| 顶部 6 个标签 | 6 张标准报表。切换时整页重算，数字来自同一个引擎 |
| **Ask for a report** | 一句话生成报表。先显示「计划」（周期、过滤条件、没能回答的部分），再显示数字 |
| 任意数字 | **点一下** → 弹出算出这个数字的每一笔交易 |
| **Record something** | 输入 `lunch 35, taxi 22, ramen 1200 JPY` → 三条草稿 → 保存后进「待确认」队列，不进任何统计 |
| **Waiting for you** | 置信度不够的记录停在这里，确认前不影响任何数字 |
| **Export as Skill** | 报表打包成 agentskills.io 规范的三文件包 |
| **Export CSV** | 全量导出，不设付费墙 |

### Ask for a report 值得试的几句

```
subscriptions over the last 12 months      → 自动合并订阅 + 涨价提醒
我上个月花了多少                             → 中文同样可用
top 5 merchants in March                   → 认得「前 5」和月份
how much did I spend on groceries last month vs the month before
                                           → 认得分类、认得环比
下个月会花多少                               → 明确拒答：只报已记录的，不做预测
```

最后一句是**故意的**：引擎只统计已记录的交易，不会为了「有个答案」画一张猜出来的图。

---

## 3. 跑测试

```bash
pnpm test        # 273 个测试，约 4 秒
pnpm typecheck   # 根目录 + web + mobile 三处类型检查
```

测试里的数字是**手算核对过**的黄金数据集。比如 2026 年 3 月的总支出 `47,456`（SGD 分），网页上、iOS 上、测试里必须是同一个数——因为它们都来自同一次计算。

---

## 4. MCP Server（把账本接给你自己的 AI）

```bash
pnpm dev:mcp     # http://localhost:8788/mcp
```

两个演示 token：`demo-read`（只读）和 `demo-write`（可写）。7 个工具，读的部分包括 schema、交易、单个指标、报表、收据；写的部分只能进待确认队列，**不能直接改数字**。

在 Claude Desktop 或任何支持远程 MCP 的客户端里配置：

```
URL:    http://localhost:8788/mcp
Header: Authorization: Bearer demo-read
```

每一次外部 AI 的读取都会记在账上，网页版底部「What your AI has read」能看到原话，比如 *"claude-desktop read 218 transactions between 2026-03-01 and 2026-03-31"*。

---

## 5. 常见问题

| 症状 | 原因和处理 |
|---|---|
| 网页显示 "is the API running on :8787?" | 终端 1 没起来，或者端口被占。换端口：`PORT=8800 pnpm dev`，网页那边设 `VITE_API_URL=http://localhost:8800` |
| 后端启动报 SQLite 相关错误 | Node 版本低于 22 |
| 想让数据重启后还在 | `KIWI_DB=./kiwi.db pnpm dev`。默认是内存库，重启即回到演示数据 |
| 想把数据清空重来 | 删掉那个 `.db` 文件，或者去掉 `KIWI_DB` 直接用内存库 |
| MCP 端口冲突 | `MCP_PORT=8899 pnpm dev:mcp` |

---

## 6. iOS

**建议分两步，不要一上来就 TestFlight。**

### 第一步：装到自己手机（不花钱，当天能看到）

```bash
pnpm --filter @kiwi/mobile exec expo prebuild -p ios
open apps/mobile/ios/*.xcworkspace
```

然后按 [`apps/mobile/native/ios/README.md`](../apps/mobile/native/ios/README.md) 在 Xcode 里加三个 target：Share Extension、Widget，以及把 App Intents 和 Bridge 加进主 App。**全是点界面，不用写代码**，大约 30–60 分钟。

跑之前把后端地址换成 Mac 的局域网 IP（`ifconfig | grep "inet "` 能看到）：

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.x:8787 pnpm dev:ios
```

手机和 Mac 在同一个 Wi-Fi 下即可。免费 Apple ID 可以签 7 天有效期的开发版。

**第一次进 App 之后再去测扩展**——App 启动时才会把「后端地址、账本 id、账户 id」写进 App Group，分享面板、快捷指令和 Widget 都靠这个。没写之前它们会明说「先打开一次 Kiwi」，而不是默默失败。

Back Tap（敲背面记账）：iOS 没有这个 API，它是一条用户自己绑定的快捷指令。
**设置 → 辅助功能 → 触控 → 轻点背面 → 轻点两下 → Kiwi: Record a purchase**。

### 第二步：TestFlight —— 三个硬门槛

1. **付费开发者账号**，$99/年。免费账号上不了 TestFlight。
2. **后端必须公网可达且是 HTTPS。** TestFlight 装到别人手机上以后，`localhost` 和局域网 IP 都不通了，必须把 API 部署到云上。
   ⚠️ **目前 API 没有任何鉴权** —— 拿到 URL 就能读写账本。要么只给自己用且不外传 URL，要么先把登录做掉再公开内测。这是真实风险。
3. **每个 target 要单独的 Bundle ID**，都要在开发者后台注册，并共享同一个 App Group：
   - `app.kiwi.finance` / `app.kiwi.finance.share` / `app.kiwi.finance.widget`
   - App Group：`group.app.kiwi.finance`

打包前记得删掉两处 `NSAllowsLocalNetworking`（`apps/mobile/app.json` 和 widget 的 `Info.plist`）——那是给本地调试开的 HTTP 后门，上架前必须关。

之后是标准流程：Xcode → Product → Archive → Distribute App → App Store Connect → 在后台添加内测人员。

---

## 7. 现在还不能做的事

说清楚比留着让人踩坑好。

| | 状态 |
|---|---|
| **Swift 代码从未编译过** | 写它的环境没有 macOS 也没有 Swift 工具链。逻辑逐行检查过，但第一次 `⌘B` 大概率有编译错误要修。TypeScript 那一半已过类型检查 |
| **真实 AI 提取** | 需要 API key。当前走确定性 stub 解析器：它是「解析」不是「预测」，输出稳定、可被测试断言，产出的记录一律落在待确认队列 |
| **叙述（报表里的文字解读）** | 守卫已经写好并测试过（模型写的每个数字都要能在事实集里找到），但生成那一步需要 key |
| **鉴权** | API 和 MCP 目前都是裸的 / 演示 token。MCP OAuth 2.1 需要部署授权服务器 |
| **评测集与准确率验证** | 需要真实票据素材，按约定暂缓 |

---

## 8. 一句话速查

```bash
pnpm install
pnpm dev          # 后端 :8787
pnpm dev:web      # 网页 :5173
pnpm dev:mcp      # MCP  :8788
pnpm dev:ios      # iOS（需要 Mac + Xcode）
pnpm test         # 273 个测试
pnpm typecheck    # 类型检查
```
