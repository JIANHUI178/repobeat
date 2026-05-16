# RepoBeat — 代码仓库健康巡检

[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-RepoBeat-green?logo=github)](https://github.com/marketplace/actions/repobeat)

**每次 push 自动给你的仓库做体检：依赖是否过期、有没有密钥泄露、代码质量趋势如何。零配置，两行就能用。**

---

## 快速开始

在你的仓库创建 `.github/workflows/repobeat.yml`：

```yaml
name: RepoBeat 巡检
on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]
  schedule:
    - cron: "7 8 * * 1"  # 每周一早 8 点

jobs:
  health-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: repobeat/action@v1
```

提交后，每次 push 和 PR 都会自动运行，结果直接显示在 PR 评论和 Actions 摘要里。

---

## 扫描什么

| 维度 | 检查内容 |
|------|---------|
| 🏃 **Git 活动** | 提交频率、活跃天数、贡献者集中度 (Bus Factor)、过期分支 |
| 📦 **依赖健康** | npm audit 漏洞、过期包、锁文件检查、Python 版本钉住 |
| 🔬 **代码质量** | 文件结构、重复代码签名检测、长函数/调试残留等代码坏味 |
| 🔒 **安全扫描** | 硬编码密钥、.gitignore 审计、CI/测试/Lock 清单 |

---

## 输入参数

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `repo-path` | 否 | `.` | 要扫描的仓库路径 |
| `fail-on-critical` | 否 | `true` | 发现严重安全问题时让 CI 失败 |
| `fail-on-score-below` | 否 | `0` | 健康评分低于此值时 CI 失败（0=禁用） |
| `comment-on-pr` | 否 | `true` | 在 PR 中自动评论巡检结果 |
| `github-token` | 否 | `${{ github.token }}` | PR 评论所需 Token |
| `artifact-name` | 否 | `repo-health-report` | 上传的 artifact 名称 |

## 输出

| 输出 | 说明 |
|------|------|
| `activity-score` | Git 提交活跃度评分 (0-100) |
| `dependency-score` | 依赖健康评分 (0-100) |
| `security-score` | 安全评分 (0-100) |
| `report-file` | 生成报告的文件路径 |

## 高级用法

```yaml
- uses: repobeat/action@v1
  with:
    fail-on-critical: "true"         # 发现密钥泄露直接失败
    fail-on-score-below: "50"        # 任一项低于 50 分 CI 失败
    comment-on-pr: "true"            # PR 评论巡检结果

# 在后续 step 中使用评分
- run: echo "安全评分: ${{ steps.health.outputs.security-score }}/100"
```

---

## 本地使用

```bash
git clone https://github.com/repobeat/action.git
cd action
node src/index.js
```

报告生成在 `reports/` 目录。

---

## 工作原理

纯 Node.js，零外部依赖。使用 Git 原生命令 + 文件系统分析，不调用任何外部 API。你的代码全程留在你的 CI 环境里，不会外传。

---

## 许可证

MIT © 2026 RepoBeat
