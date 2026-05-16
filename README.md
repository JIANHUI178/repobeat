# RepoHealth — 自动化代码仓库健康巡检系统

对 Git 仓库进行多维健康扫描，生成 Markdown 报告并追踪历史趋势。

## 快速开始

```bash
# 扫描 config.json 中配置的所有仓库
node src/index.js

# 仅基于已有数据生成趋势报告
node src/index.js --report-only
```

## 扫描维度

| 维度 | 分析内容 |
|------|---------|
| Git 活动分析 | 提交频率、贡献者集中度、分支健康、Bus Factor |
| 依赖健康 | 过期包检测、已知漏洞 (npm audit)、锁文件检查 |
| 代码质量 | 文件结构、重复代码检测、代码坏味识别 |
| 安全扫描 | 密钥泄露检测、.gitignore 审计、安全清单 |

## 配置

编辑 `config.json` 添加要监控的仓库：

```json
{
  "repositories": [
    { "name": "我的项目", "path": "/path/to/repo", "enabled": true }
  ],
  "thresholds": {
    "largeFileKB": 500,
    "inactiveDays": 90
  }
}
```

## 自动化

使用系统定时任务或 CI 定期运行：

```bash
# 每天早上 8 点扫描
0 8 * * * cd /path/to/repo-health && node src/index.js
```
