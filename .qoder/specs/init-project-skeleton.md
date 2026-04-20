# Plan: 初始化 x402 网关 MVP 项目骨架

## Context

项目已有完整的设计文档（docs/ 下 6 份文件），但尚无任何代码、配置或 Git 仓库。需要从零初始化一个可运行的 TypeScript + Fastify 项目骨架，包含所有模块的接口定义和 stub 实现，使后续开发（OpenHands）可以在明确的边界内填充实现。

## 技术选型（已确认）

- 包管理器：pnpm
- 测试框架：Vitest
- 本地基础设施：Docker Compose（PostgreSQL 16 + Redis 7）

## 文件树（~40 个文件）

```
program/
├── .gitignore
├── .env.example
├── .eslintrc.cjs
├── AGENTS.md
├── README.md
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── app.ts                    # Fastify 应用工厂
│   ├── server.ts                 # 入口点（listen + graceful shutdown）
│   ├── config.ts                 # 环境变量加载与 zod 校验
│   ├── errors.ts                 # 9 个 API 错误码 → 类型化错误类
│   ├── types.ts                  # 共享领域类型（Request/Response/Receipt/ModelInfo）
│   ├── gateway/
│   │   ├── index.ts
│   │   ├── routes.ts             # 3 个端点的薄 handler
│   │   ├── middleware.ts         # trace-id 注入、请求校验 hook
│   │   └── schemas.ts            # Zod 请求体/头部 schema
│   ├── x402/
│   │   ├── index.ts
│   │   ├── challenge.service.ts  # challenge 生成/签名/验证
│   │   ├── verify.service.ts     # 链上支付证明验证
│   │   ├── replay.service.ts     # Redis 重放保护 + 幂等缓存
│   │   └── types.ts
│   ├── router/
│   │   ├── index.ts
│   │   ├── router.service.ts     # manual/auto 路由编排
│   │   ├── fallback.service.ts   # 回退链执行
│   │   ├── policy.ts             # 模型评分策略引擎
│   │   └── types.ts
│   ├── provider/
│   │   ├── index.ts
│   │   ├── adapter.ts            # 抽象适配器接口
│   │   ├── openai.adapter.ts     # OpenAI 兼容上游适配器
│   │   ├── registry.ts           # 模型目录注册与查询
│   │   └── types.ts
│   ├── billing/
│   │   ├── index.ts
│   │   ├── meter.service.ts      # token 用量计量
│   │   ├── cost.service.ts       # 成本分解计算
│   │   ├── ledger.service.ts     # append-only 账本写入
│   │   └── types.ts
│   └── audit/
│       ├── index.ts
│       ├── trace.service.ts      # 请求追踪持久化
│       ├── receipt.service.ts    # 回执查询与重建
│       └── types.ts
└── test/
    ├── setup.ts
    ├── helpers.ts
    ├── x402/
    │   └── challenge.test.ts
    ├── router/
    │   └── router.test.ts
    └── integration/
        └── flow.test.ts
```

## 依赖

**生产依赖：**
fastify, @fastify/cors, @fastify/helmet, @fastify/rate-limit, @fastify/sensible,
ioredis, pg, kysely, zod, jose, nanoid, pino, dotenv, viem

**开发依赖：**
typescript, tsx, vitest, @types/node, @types/pg,
eslint, @typescript-eslint/eslint-plugin, @typescript-eslint/parser, prettier

## 各模块职责摘要

| 模块 | 核心导出 | 关键方法 |
|------|---------|---------|
| `errors.ts` | 9 个错误类 + `errorToResponse()` | 统一错误处理 |
| `types.ts` | ChatCompletionRequest/Response, UsageReceipt, ModelInfo | 领域类型合约 |
| `config.ts` | `loadConfig()` | 环境变量校验 |
| `gateway/routes.ts` | `registerRoutes()` | POST /v1/chat/completions, GET /v1/models, GET /v1/audit/requests/:id |
| `x402/challenge` | `ChallengeService` | generateChallenge(), verifyChallenge(), computeRequestHash() |
| `x402/verify` | `PaymentVerifyService` | verifyPayment() — 链上验证 |
| `x402/replay` | `ReplayProtectionService` | checkAndMark(), checkIdempotency(), saveIdempotency() |
| `router/router` | `RouterService` | route() — manual/auto 编排 |
| `router/fallback` | `FallbackService` | executeWithFallback() — 不重复扣费 |
| `router/policy` | `PolicyEngine` | scoreModels(), selectBest() |
| `provider/adapter` | `ProviderAdapter` 接口 | execute(), healthCheck() |
| `provider/openai` | `OpenAIAdapter` | OpenAI 兼容上游调用 |
| `provider/registry` | `ProviderRegistry` | register(), listModels(), getModelPricing() |
| `billing/meter` | `MeterService` | recordUsage() |
| `billing/cost` | `CostService` | calculateCost() — 确定性计算 |
| `billing/ledger` | `LedgerService` | commit()（只 INSERT，不 UPDATE/DELETE） |
| `audit/trace` | `TraceService` | startTrace(), completeTrace() |
| `audit/receipt` | `ReceiptService` | getByRequestId() — 审计回执重建 |

## Stub 模式

每个 service 遵循统一模式：
1. 导出 **接口**（描述合约）
2. 导出 **工厂函数** `createXxxService(deps)` 返回接口实现
3. 每个方法有 JSDoc 注释说明其职责
4. 方法体为 `throw new Error('Not implemented')`
5. 依赖通过工厂参数显式注入（非全局状态）

## 执行顺序

1. `git init`
2. 根配置文件：.gitignore, package.json, tsconfig.json, vitest.config.ts, .eslintrc.cjs, .env.example, docker-compose.yml
3. 文档：README.md, AGENTS.md
4. 共享源码：config.ts, types.ts, errors.ts
5. 叶子模块：provider/, billing/, audit/
6. 核心模块：x402/, router/
7. 网关层：gateway/
8. 应用装配：app.ts, server.ts
9. 测试脚手架：test/
10. `pnpm install` → `pnpm typecheck` 验证

## 验证

1. `pnpm install` 成功
2. `pnpm typecheck` 无错误
3. `pnpm lint` 无错误
4. `pnpm test` 运行（placeholder 测试通过）
5. `docker compose up -d` 启动 PG + Redis
6. `pnpm dev` 启动服务器，访问 `GET /v1/models` 返回空目录
