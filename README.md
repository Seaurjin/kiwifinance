# Kiwi Finance

AI 原生的个人财务数据层。

> **一句话定位**：记录极简到只需截个图；分析强到可以用一句话生成任何报表；数据随时可以交给你自己的 AI。

## 三条不可违背的原则

1. **数字永远不来自模型** —— LLM 只输出「查询规格」，计算由确定性引擎完成，每个数字可点击溯源
2. **多币种是地基，不是功能** —— 第一行 schema 就带原币种 + 汇率 + 本位币
3. **用户的数据属于用户** —— MCP 连接、全量导出、Skill 导出三条通道永远开放

## 当前状态

**Phase 0 进行中。** 确定性内核已落地并全部通过测试（139 个测试，typecheck 干净）。

```bash
pnpm install && pnpm test && pnpm typecheck
```

| Phase 0 任务 | 状态 |
|---|---|
| Report Spec JSON Schema + 校验器 | ✅ `@kiwi/report-spec` |
| 指标库 v0 + 黄金数据集 | ✅ `@kiwi/metrics`（13 个指标，逐个手算核对） |
| 多币种数据模型定稿 | ✅ `@kiwi/core` + `@kiwi/ledger`（含 SQL DDL 与不变量校验） |
| ModelRouter 契约 | ✅ `@kiwi/model-router`（含中国合规路由的构造期强制） |
| Narrator 事实约束守卫 | ✅ 超出计划范围，把 FR-ANA-06 变成可执行的门 |
| 500+ 真实收据评测集 | ⬜ 需要真实票据素材 |
| AI 提取 Spike + 准确率验证 | ⬜ 需要 API Key |
| Prompt injection 对抗测试 | ⬜ 用例集可先写，跑通需要模型 |
| 两段式提取对照实验 | ⬜ 需要模型 |
| 核心 6 页设计稿 | ⬜ |

代码结构与设计说明见 [`packages/README.md`](packages/README.md)。

## 文档

| 文档 | 内容 |
|---|---|
| **[`docs/PRD.md`](docs/PRD.md)** | **产品需求文档 —— 需求的唯一真源。**编号化的功能/非功能需求、验收标准、发布计划、待决策项 |
| [`docs/00-project-prompt.md`](docs/00-project-prompt.md) | 可直接粘贴给任何 AI 的项目上下文 prompt（自包含） |
| [`docs/01-market-research.md`](docs/01-market-research.md) | 市场与竞品调研：咔皮记账拆解、海外/中国/华人东南亚三个市场、定位支柱、风险清单 |
| [`docs/02-product-and-dev-plan.md`](docs/02-product-and-dev-plan.md) | 功能范围、技术栈、单位经济、四阶段开发计划与决策门、定价 |
| [`docs/03-ai-native-architecture.md`](docs/03-ai-native-architecture.md) | **技术骨架**：捕获层、多币种账本内核、指标引擎、Report Spec、Skill 化、MCP Server、成本分层 |
| [`docs/04-model-strategy.md`](docs/04-model-strategy.md) | **模型选型双轨**：海外（Gemini / OpenAI）与中国（国产已备案模型）两套组合、价格表、合规约束、ModelRouter 抽象层 |

## 架构一览

```
捕获层 → 多币种账本内核 → 指标引擎 → AI Harness → 内置报表 / 个性化报表 / MCP Server
                                        ↑
              意图 → Planner(LLM) → Report Spec(JSON) → 引擎执行
                   → 事实集 → Narrator(LLM，只能引用事实) → 渲染器(确定性)
```

核心机制是 **text-to-spec, not text-to-answer**：模型产出查询规格，引擎产出数字。

## 市场优先级

1. **海外英文市场**（美/加/英/澳）— iOS 优先，多币种从第一天可用
2. **中国大陆** — Phase 4
3. **华人 / 跨境人群** — 首发市场内最容易口碑引爆的种子人群

## 文档关系

- **`PRD.md` 是需求真源** —— 要改需求，改这里，条目都有编号（如 `FR-CAP-03`、`D-1`）
- `01`–`04` 是**依据文档**，记录调研过程与设计推导，供追溯为什么这么定
- `00-project-prompt.md` 是**给 AI 的上下文**，产品决策变更时同步更新

## 下一步

定下 [`docs/PRD.md` § 14 待决策](docs/PRD.md#14-待决策) 的 8 项（D-1 至 D-8），即可进入 Phase 0。
