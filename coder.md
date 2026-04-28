# Coder Workflow Documentation

## 标准Issue处理流程

### 1. 同步代码
```bash
# 确认当前分支
git branch --show-current

# 如果不是ai-dev分支，切换到ai-dev
git checkout ai-dev

# 同步远程代码
git pull origin ai-dev
```

### 2. 检查Issue
- 查看GitHub上的open issues
- 阅读issue描述，确认问题是否属实
- 检查相关代码文件验证问题

### 3. 修复代码
- 根据issue描述定位问题
- 按照项目架构规范修改代码
- 保持PR边界：≤3文件，≤200行改动

### 4. 运行测试
```bash
# 代码质量检查
pnpm lint
pnpm typecheck

# 功能测试
pnpm test

# 性能测试（P3-P5阶段）
pnpm test:perf
```

### 5. 提交代码
```bash
# 查看改动
git diff --stat

# 提交到ai-dev分支
git add .
git commit -m "fix: 描述修复内容 (fixes #issue_number)"
git push origin ai-dev
```

### 6. 创建PR
- 从ai-dev分支创建PR
- 关联相关issue（在PR描述中使用 `fixes #issue_number`）
- 包含：改动说明、测试证据、风险说明

### 7. 等待审核
- PR必须通过功能测试
- 等待manager审核
- 审核通过后合并到dev分支

## 当前示例：Issue #48修复流程

### 问题描述
1. Base Sepolia USDC地址缺失
2. PAYMENT_CHAIN配置未生效
3. RPC/Chain ID不匹配

### 修复步骤
1. **修改文件**:
   - `src/x402/verify.service.ts`: 添加多链支持
   - `src/app.ts`: 传入paymentChain参数

2. **关键改动**:
   - 添加USDC_CONTRACTS映射表支持多链
   - 添加CHAIN_MAPPING映射表选择viem chain
   - 修改createPaymentVerifyService接受paymentChain参数
   - 默认fallback到Base Mainnet配置

3. **测试验证**:
   - 通过lint检查
   - 通过typecheck检查
   - 通过175/177功能测试（2个失败测试为已有问题）

4. **PR信息**:
   - 改动行数: 2文件，30插入(+)，8删除(-)
   - 关联Issue: #48
