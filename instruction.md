# x402 Gateway 部署指南

**版本**: v0.1.0  
**最后更新**: 2026-04-20  
**目标环境**: 测试网 (Base Sepolia) + 生产服务器

---

## 1. 系统要求

### 1.1 硬件要求

**最低配置** (开发/测试):
- CPU: 2 cores
- RAM: 4 GB
- 磁盘: 20 GB SSD
- 网络: 10 Mbps

**推荐配置** (生产):
- CPU: 4+ cores
- RAM: 8+ GB
- 磁盘: 50+ GB NVMe SSD
- 网络: 100+ Mbps

### 1.2 软件要求

- **Node.js**: >= 20.0.0 (推荐 v20.20.1 LTS)
- **pnpm**: >= 8.0.0
- **PostgreSQL**: >= 14.0
- **Redis**: >= 6.2
- **Docker** & **Docker Compose** (可选，用于快速部署)
- **Git**: >= 2.30

---

## 2. Base Sepolia 测试网环境搭建

### 2.1 为什么使用 Base Sepolia？

本项目使用 **x402 支付协议**，基于 EVM 兼容链实现：
- **Base**: Coinbase 的 Layer 2，低 gas 费，高吞吐量
- **Sepolia 测试网**: 用于开发和测试，无需真实资金
- **USDC**: 稳定币，用于支付网关费用

### 2.2 安装 Base 测试网工具

#### 步骤1: 安装 Node.js 和 pnpm

```bash
# 使用 nvm 安装 Node.js 20 LTS
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20

# 安装 pnpm
npm install -g pnpm
```

#### 步骤2: 获取测试网 ETH

1. 访问 [Base Sepolia Faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia)
2. 连接钱包（MetaMask）
3. 请求测试 ETH（用于 gas 费）

或者使用 Alchemy Faucet:
```bash
curl -X POST https://base-sepolia.g.alchemy.com/v2/demo \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_requestAccounts","params":[],"id":1}'
```

#### 步骤3: 配置 MetaMask 添加 Base Sepolia

- **Network Name**: Base Sepolia
- **RPC URL**: `https://sepolia.base.org`
- **Chain ID**: 84532
- **Currency Symbol**: ETH
- **Block Explorer**: `https://sepolia.basescan.org`

### 2.3 部署测试 USDC 合约（可选）

如果需要自定义 USDC 用于测试：

```bash
# 安装 Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup

# 创建项目
forge init x402-test-token
cd x402-test-token

# 部署 USDC Mock 合约
forge create --rpc-url https://sepolia.base.org \
  --private-key $YOUR_PRIVATE_KEY \
  src/USDCMock.sol:USDCMock
```

---

## 3. 服务器环境准备

### 3.1 更新系统包

```bash
# Ubuntu/Debian
sudo apt update && sudo apt upgrade -y

# 安装必要工具
sudo apt install -y curl git wget build-essential
```

### 3.2 安装 PostgreSQL

```bash
# 安装 PostgreSQL 14+
sudo apt install -y postgresql postgresql-contrib

# 启动服务
sudo systemctl start postgresql
sudo systemctl enable postgresql

# 创建数据库和用户
sudo -u postgres psql <<EOF
CREATE DATABASE x402_gateway;
CREATE USER gateway_user WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE x402_gateway TO gateway_user;
\q
EOF
```

### 3.3 安装 Redis

```bash
# 安装 Redis
sudo apt install -y redis-server

# 启动服务
sudo systemctl start redis-server
sudo systemctl enable redis-server

# 验证安装
redis-cli ping
# 应返回: PONG
```

---

## 4. 应用部署

### 4.1 克隆代码库

```bash
# 克隆仓库
git clone https://github.com/zcf-cyber/x402-gateway.git
cd x402-gateway

# 切换到目标分支
git checkout dev  # 或 main (生产环境)
```

### 4.2 安装依赖

```bash
# 安装 Node.js 依赖
pnpm install

# 构建项目
pnpm build
```

### 4.3 配置环境变量

复制环境变量模板：

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```env
# === 服务器配置 ===
PORT=3000
HOST=0.0.0.0
NODE_ENV=production
LOG_LEVEL=info

# === 数据库配置 ===
DATABASE_URL=postgresql://gateway_user:your_secure_password@localhost:5432/x402_gateway

# === Redis 配置 ===
REDIS_URL=redis://localhost:6379

# === x402 支付配置 ===
# 重要：CHALLENGE_SECRET 至少 32 字符，使用强随机字符串
CHALLENGE_SECRET=$(openssl rand -hex 32)
CHALLENGE_TTL_SECONDS=300

# Base Sepolia 测试网商户地址（你的钱包地址）
MERCHANT_ADDRESS=0xYourWalletAddress
PAYMENT_CHAIN=base
PAYMENT_ASSET=USDC

# === RPC 配置 ===
# Base Sepolia 测试网 RPC
EVM_RPC_URL=https://sepolia.base.org

# === Provider API Keys ===
OPENAI_API_KEY=sk-your-openai-key
ANTHROPIC_API_KEY=sk-your-anthropic-key

# === 平台费用 (basis points, 500 = 5%) ===
PLATFORM_FEE_BPS=500
```

**安全提示**:
- 永远不要将 `.env` 文件提交到 Git
- 使用 `openssl rand -hex 32` 生成强随机密钥
- 生产环境使用密钥管理服务（如 AWS Secrets Manager）

### 4.4 初始化数据库

```bash
# 如果使用 Docker Compose（推荐）
docker compose up -d

# 验证服务运行
docker compose ps
# 应显示 PostgreSQL 和 Redis 容器运行中
```

如果使用本地数据库，运行迁移脚本（如果有）：

```bash
# 检查是否有迁移脚本
ls -la migrations/

# 运行迁移（根据实际迁移工具调整）
# 示例使用 kysely:
# npx kysely migrate:latest
```

### 4.5 运行测试

```bash
# 运行单元测试
pnpm test

# 运行类型检查
pnpm typecheck

# 运行 lint
pnpm lint

# 所有测试通过后，准备启动
```

**注意**: 负载测试默认在 CI 环境运行 60 秒，生产验证运行 10 分钟。

```bash
# CI 环境（快速测试）
CI=true pnpm test -- test/perf/load.test.ts

# 生产验证（完整测试）
pnpm test -- test/perf/load.test.ts
```

---

## 5. 启动服务

### 5.1 开发模式

```bash
# 热重载模式（开发环境）
pnpm dev
```

### 5.2 生产模式

```bash
# 构建项目
pnpm build

# 启动生产服务器
pnpm start
```

### 5.3 使用 PM2 管理进程（推荐生产环境）

```bash
# 安装 PM2
npm install -g pm2

# 启动应用
pm2 start dist/server.js --name x402-gateway

# 设置开机自启
pm2 startup
pm2 save

# 查看日志
pm2 logs x402-gateway

# 监控
pm2 monit
```

### 5.4 使用 Docker Compose（推荐）

```bash
# 启动所有服务（PostgreSQL + Redis + Gateway）
docker compose up -d

# 查看日志
docker compose logs -f gateway

# 停止服务
docker compose down

# 完全清理（包括数据卷）
docker compose down -v
```

---

## 6. 验证部署

### 6.1 健康检查

```bash
# 检查服务是否运行
curl http://localhost:3000/v1/models

# 预期响应:
# {"data":[]}
```

### 6.2 测试 402 支付流程

#### 步骤1: 获取 Challenge

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o",
    "messages": [
      {"role": "user", "content": "Hello, test payment flow"}
    ]
  }'

# 预期响应 (402):
# {
#   "error": {
#     "code": "payment_required",
#     "message": "Payment proof required"
#   },
#   "payment_requirements": {
#     "quote_id": "q_xxx",
#     "chain": "base",
#     "asset": "USDC",
#     "amount": "0.001",
#     "expires_at": "2026-04-20T12:05:00Z",
#     "merchant_address": "0x...",
#     "request_hash": "rh_xxx",
#     "challenge_token": "eyJ..."
#   }
# }
```

#### 步骤2: 提交支付证明

```bash
# 从步骤1获取 challenge_token
CHALLENGE_TOKEN="eyJ..."

# 生成支付证明（需要钱包签名）
PAYMENT_PROOF=$(node -e '
  const proof = {
    tx_hash: "0xYourTransactionHash",
    chain: "base",
    payer_address: "0xYourAddress",
    amount: "0.001",
    asset: "USDC"
  };
  console.log(Buffer.from(JSON.stringify(proof)).toString("base64url"));
')

# 提交支付
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-402-Challenge: $CHALLENGE_TOKEN" \
  -H "X-402-Payment: $PAYMENT_PROOF" \
  -d '{
    "model": "openai/gpt-4o",
    "messages": [
      {"role": "user", "content": "Hello after payment"}
    ]
  }'

# 预期响应 (200):
# {
#   "id": "req_xxx",
#   "object": "chat.completion",
#   "created": 1770000000,
#   "model": "openai/gpt-4o",
#   "choices": [...],
#   "usage": {...},
#   "usage_receipt": {
#     "request_id": "req_xxx",
#     "quote_id": "q_xxx",
#     "payer_address": "0x...",
#     "total_cost_usd": "0.00019",
#     ...
#   }
# }
```

### 6.3 测试审计 API

```bash
# 使用步骤2返回的 request_id
REQUEST_ID="req_xxx"

curl http://localhost:3000/v1/audit/requests/$REQUEST_ID

# 预期响应:
# {
#   "data": {
#     "request_id": "req_xxx",
#     "request_hash": "rh_xxx",
#     "routing_mode": "auto",
#     "route_decision": {...},
#     "usage": {...},
#     "cost": {...},
#     "payment": {...}
#   }
# }
```

### 6.4 测试幂等性

```bash
# 第一次请求
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-402-Challenge: $CHALLENGE_TOKEN" \
  -H "X-402-Payment: $PAYMENT_PROOF" \
  -H "Idempotency-Key: test-idem-001" \
  -d '{"model": "openai/gpt-4o", "messages": [{"role": "user", "content": "Test"}]}'

# 第二次相同请求（应返回相同 response）
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-402-Challenge: $CHALLENGE_TOKEN" \
  -H "X-402-Payment: $PAYMENT_PROOF" \
  -H "Idempotency-Key: test-idem-001" \
  -d '{"model": "openai/gpt-4o", "messages": [{"role": "user", "content": "Test"}]}'

# 两次请求的 usage_receipt.request_id 应该相同
```

---

## 7. 监控和日志

### 7.1 查看日志

```bash
# PM2 日志
pm2 logs x402-gateway --lines 100

# Docker 日志
docker compose logs -f gateway

# 系统日志
journalctl -u x402-gateway -f
```

### 7.2 性能监控

```bash
# 使用 autocannon 进行负载测试
npm install -g autocom cannon

# 测试 20 RPS，持续 60 秒
autocannon -c 20 -d 60 -m POST \
  -H "Content-Type: application/json" \
  -b '{"model":"openai/gpt-4o","messages":[{"role":"user","content":"test"}]}' \
  http://localhost:3000/v1/chat/completions
```

### 7.3 数据库监控

```bash
# PostgreSQL 连接数
sudo -u postgres psql -c "SELECT count(*) FROM pg_stat_activity;"

# Redis 内存使用
redis-cli INFO memory | grep used_memory_human
```

---

## 8. 故障排除

### 8.1 常见问题

#### 问题1: 数据库连接失败

```bash
# 检查 PostgreSQL 是否运行
sudo systemctl status postgresql

# 检查连接字符串
echo $DATABASE_URL

# 测试连接
psql $DATABASE_URL -c "SELECT 1;"
```

#### 问题2: Redis 连接失败

```bash
# 检查 Redis 是否运行
sudo systemctl status redis-server

# 测试连接
redis-cli ping
```

#### 问题3: Challenge 签名验证失败

检查 `.env` 中的 `CHALLENGE_SECRET`:
- 至少 32 字符
- 使用强随机字符串
- 重启服务后旧 challenge 会失效

#### 问题4: 支付验证失败

- 确认 `MERCHANT_ADDRESS` 正确
- 确认 `EVM_RPC_URL` 可访问
- 检查 Base Sepolia 测试网状态

### 8.2 重置数据库

```bash
# 警告：这会删除所有数据！
sudo -u postgres psql <<EOF
DROP DATABASE x402_gateway;
CREATE DATABASE x402_gateway;
GRANT ALL PRIVILEGES ON DATABASE x402_gateway TO gateway_user;
\q
EOF

# 重新运行迁移
# npx kysely migrate:latest
```

---

## 9. 安全建议

### 9.1 生产环境清单

- [ ] 使用 HTTPS（配置反向代理如 Nginx）
- [ ] 启用防火墙（仅开放必要端口）
- [ ] 使用强密码和密钥
- [ ] 定期更新依赖 (`pnpm update`)
- [ ] 配置日志轮转
- [ ] 设置数据库备份
- [ ] 监控告警配置
- [ ] 限制 API 速率（已内置 rate limiting）

### 9.2 Nginx 反向代理配置

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 10. 升级和维护

### 10.1 更新代码

```bash
# 拉取最新代码
git pull origin dev

# 安装新依赖
pnpm install

# 重新构建
pnpm build

# 重启服务
pm2 restart x402-gateway
# 或
docker compose restart gateway
```

### 10.2 数据库迁移

```bash
# 检查迁移状态
# npx kysely migrate:list

# 执行迁移
# npx kysely migrate:latest
```

---

## 11. 参考资源

- **Base Sepolia 文档**: https://docs.base.org/base-learn/docs/welcome
- **x402 协议规范**: `docs/api-spec-v0-x402-gateway.md`
- **工程规范**: `docs/ENGINEERING_PLAYBOOK.md`
- **架构决策**: `docs/adr-001-x402-only-architecture.md`
- **GitHub 仓库**: https://github.com/zcf-cyber/x402-gateway

---

## 12. 支持

如遇问题，请：

1. 查看 `CODE_REVIEW_REPORT.md` 了解已知问题
2. 查看 GitHub Issues: https://github.com/zcf-cyber/x402-gateway/issues
3. 创建新的 Issue 报告问题

---

**部署检查清单**:

- [ ] 系统要求满足
- [ ] Base Sepolia 测试网配置完成
- [ ] PostgreSQL 和 Redis 运行正常
- [ ] 环境变量正确配置
- [ ] 测试全部通过
- [ ] 服务启动成功
- [ ] 402 支付流程验证通过
- [ ] 审计 API 验证通过
- [ ] 幂等性验证通过
- [ ] 监控和日志配置完成

**祝部署顺利！** 🚀
