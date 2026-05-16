const fs = require("fs");
const path = require("path");

class Reporter {
  constructor(reportDir, dataDir) {
    this.reportDir = path.resolve(reportDir);
    this.dataDir = path.resolve(dataDir);
    fs.mkdirSync(this.reportDir, { recursive: true });
    fs.mkdirSync(this.dataDir, { recursive: true });
  }

  /** 生成健康评分卡片 */
  _scoreBar(score, label) {
    const bar = "█".repeat(Math.round(score / 10)) + "░".repeat(10 - Math.round(score / 10));
    const emoji = score >= 80 ? "🟢" : score >= 50 ? "🟡" : "🔴";
    return `${emoji} ${label}: **${score}/100** \`${bar}\``;
  }

  /** 生成完整 Markdown 报告 */
  generate(repoName, scanResult, depResult, qualityResult, securityResult) {
    const now = new Date().toLocaleString("zh-CN");
    const git = scanResult;
    const dep = depResult;
    const qual = qualityResult;
    const sec = securityResult;

    let md = "";
    md += `# 📊 RepoBeat 巡检报告\n\n`;
    md += `**仓库**: ${repoName}  |  **扫描时间**: ${now}\n\n`;
    md += `---\n\n`;

    // ========== 总览面板 ==========
    md += `## 📈 健康总览\n\n`;
    md += `| 维度 | 评分 | 状态 |\n`;
    md += `|------|------|------|\n`;
    md += `| 提交活跃度 | ${git.commitActivity.activityScore}/100 | ${git.commitActivity.isHealthy ? "✅" : "⚠️"} |\n`;
    md += `| 依赖健康 | ${dep.overallHealthScore}/100 | ${dep.overallHealthScore >= 80 ? "✅" : dep.overallHealthScore >= 50 ? "⚠️" : "🔴"} |\n`;
    md += `| 安全评分 | ${sec.securityScore}/100 | ${sec.securityScore >= 80 ? "✅" : sec.securityScore >= 50 ? "⚠️" : "🔴"} |\n`;
    md += `\n${this._scoreBar(git.commitActivity.activityScore, "开发活跃度")}\n`;
    md += `${this._scoreBar(dep.overallHealthScore, "依赖健康度")}\n`;
    md += `${this._scoreBar(sec.securityScore, "安全评分")}\n\n`;

    // ========== 一、Git 活动分析 ==========
    md += `---\n## 🔧 一、Git 活动分析\n\n`;
    md += `### 提交活跃度（近 ${git.commitActivity.period}）\n\n`;
    md += `| 指标 | 值 |\n|------|----|\n`;
    md += `| 总提交数 | ${git.commitActivity.totalCommits} |\n`;
    md += `| 日均提交 | ${git.commitActivity.avgPerDay} |\n`;
    md += `| 活跃天数 | ${git.commitActivity.activeDays} |\n`;
    md += `| 活跃一致性 | ${git.commitActivity.consistency}% |\n`;
    md += `| 贡献者数 | ${git.commitActivity.uniqueAuthors} |\n\n`;

    md += `**Top 5 贡献者**:\n\n`;
    md += `| 贡献者 | 提交数 |\n|--------|--------|\n`;
    for (const a of git.commitActivity.topAuthors) {
      md += `| ${a.name} | ${a.count} |\n`;
    }

    md += `\n### 贡献者集中度（Bus Factor）\n\n`;
    md += `| 指标 | 值 |\n|------|----|\n`;
    md += `| 集中度风险 | ${git.contributorRisk.risk} (${git.contributorRisk.riskLevel}) |\n`;
    md += `| 巴士因子 | ${git.contributorRisk.busFactor} |\n`;
    md += `| 前2名占比 | ${(git.contributorRisk.risk * 100).toFixed(0)}% |\n\n`;

    md += `| 贡献者 | 提交数 | 占比 |\n|--------|--------|------|\n`;
    for (const c of git.contributorRisk.topContributors) {
      md += `| ${c.name} | ${c.commits} | ${c.percentage}% |\n`;
    }

    md += `\n### 分支健康\n\n`;
    md += `| 指标 | 值 |\n|------|----|\n`;
    md += `| 总分支数 | ${git.branchHealth.totalBranches} |\n`;
    md += `| 当前分支 | ${git.branchHealth.currentBranch} |\n`;
    md += `| 过期分支 (>90天) | ${git.branchHealth.staleCount} |\n`;
    if (git.branchHealth.staleBranches.length > 0) {
      md += `\n过期分支: ${git.branchHealth.staleBranches.map((b) => "`" + b + "`").join(", ")}\n`;
    }

    // ========== 二、依赖健康 ==========
    md += `\n---\n## 📦 二、依赖健康\n\n`;
    md += `**总体评分**: ${dep.overallHealthScore}/100  |  **过期包**: ${dep.totalOutdated}  |  **漏洞**: ${dep.totalVulnerabilities}\n\n`;
    md += `**锁文件**: ${dep.lockFiles.found.length > 0 ? dep.lockFiles.found.join(", ") : "无"}  |  **缺失**: ${dep.lockFiles.missing.length > 0 ? dep.lockFiles.missing.join(", ") : "无"}\n\n`;

    if (dep.scanners.npm) {
      const n = dep.scanners.npm;
      md += `### NPM 依赖\n\n`;
      md += `| 指标 | 值 |\n|------|----|\n`;
      md += `| 总依赖 | ${n.totalDeps} |\n`;
      md += `| 过期包 | ${n.outdated.length} |\n`;
      md += `| 漏洞 L/M/H/C | ${n.auditIssues.low}/${n.auditIssues.moderate}/${n.auditIssues.high}/${n.auditIssues.critical} |\n`;

      if (n.outdated.length > 0) {
        md += `\n**过期包详情**:\n\n`;
        md += `| 包名 | 当前 | 最新 | 落后 |\n|------|------|------|------|\n`;
        for (const o of n.outdated.slice(0, 15)) {
          md += `| ${o.name} | ${o.current} | ${o.latest} | ${o.wanted !== o.latest ? "⚠️ major" : "minor"} |\n`;
        }
        if (n.outdated.length > 15) md += `| ... | 还有 ${n.outdated.length - 15} 个 | | |\n`;
      }
    }

    if (dep.scanners.pip) {
      const p = dep.scanners.pip;
      md += `### Python 依赖\n`;
      md += `| 总依赖 | 版本钉住 | 未钉住 | 评分 |\n`;
      md += `|--------|----------|--------|------|\n`;
      md += `| ${p.totalDeps} | ${p.pinned} | ${p.unpinned} | ${p.healthScore} |\n`;
      if (p.note) md += `\n> ⚠️ ${p.note}\n`;
    }

    // ========== 三、代码质量 ==========
    md += `\n---\n## 🔬 三、代码质量\n\n`;
    md += `| 指标 | 值 |\n|------|----|\n`;
    md += `| 源码文件数 | ${qual.structure.totalFiles} |\n`;
    md += `| 总代码行 | ${qual.structure.totalCodeLines} |\n`;
    md += `| 总注释行 | ${qual.structure.totalCommentLines} |\n`;
    md += `| 总空行 | ${qual.structure.totalBlankLines} |\n`;
    md += `| 平均文件大小 | ${qual.structure.avgFileSize} 行 |\n\n`;

    if (qual.structure.top10Largest.length > 0) {
      md += `**最大的文件**:\n\n`;
      md += `| 文件 | 代码行 |\n|------|--------|\n`;
      for (const f of qual.structure.top10Largest.slice(0, 5)) {
        md += `| ${f.file} | ${f.codeLines} |\n`;
      }
      md += "\n";
    }

    md += `### 重复代码\n\n`;
    md += `| 指标 | 值 |\n|------|----|\n`;
    md += `| 重复组数 | ${qual.duplicates.duplicateGroups} |\n`;
    md += `| 涉及文件 | ${qual.duplicates.filesInDuplicates} |\n\n`;

    md += `### 代码坏味\n\n`;
    md += `| 坏味总数 | 严重程度 |\n|----------|----------|\n`;
    md += `| ${qual.codeSmells.totalSmells} | ${qual.codeSmells.severity} |\n\n`;
    if (qual.codeSmells.smells.length > 0) {
      md += `| 文件 | 类型 | 详情 |\n|------|------|------|\n`;
      for (const s of qual.codeSmells.smells.slice(0, 10)) {
        md += `| ${s.file} | ${s.type} | ${s.detail} |\n`;
      }
      md += "\n";
    }

    if (qual.structure.lowCommentFiles.length > 0) {
      md += `**注释率过低的文件**: ${qual.structure.lowCommentFiles.map((f) => f.file).slice(0, 5).join(", ")}\n\n`;
    }

    // ========== 四、安全扫描 ==========
    md += `\n---\n## 🔒 四、安全扫描\n\n`;
    md += `**安全评分**: ${sec.securityScore}/100  |  **严重**: ${sec.criticalCount}  |  **高风险**: ${sec.highCount}\n\n`;

    md += `### 密钥检测\n\n`;
    if (sec.secretFindings.length > 0) {
      md += `| 文件 | 类型 | 严重度 | 数量 |\n|------|------|--------|------|\n`;
      for (const f of sec.secretFindings) {
        md += `| ${f.file} | ${f.pattern} | ${f.severity} | ${f.count} |\n`;
      }
      md += "\n";
    } else {
      md += `✅ 未检测到硬编码密钥。\n\n`;
    }

    md += `### .gitignore 检查\n\n`;
    if (sec.gitignoreStatus.hasGitignore) {
      md += `✅ .gitignore 存在`;
      if (sec.gitignoreStatus.missingPatterns.length > 0) {
        md += `，建议添加: ${sec.gitignoreStatus.missingPatterns.map((p) => "`" + p + "`").join(", ")}`;
      }
      md += "\n\n";
    } else {
      md += `⚠️ **缺失 .gitignore 文件！**\n\n`;
    }

    md += `### 基础安全清单\n\n`;
    md += `| 检查项 | 状态 |\n|--------|------|\n`;
    for (const c of sec.baselineChecks) {
      md += `| ${c.item} | ${c.pass ? "✅" : "❌"} |\n`;
    }
    md += "\n";

    // ========== 五、建议操作 ==========
    md += `---\n## 💡 五、建议操作\n\n`;
    const recommendations = this._generateRecommendations(git, dep, qual, sec);
    if (recommendations.length > 0) {
      for (let i = 0; i < recommendations.length; i++) {
        md += `${i + 1}. ${recommendations[i]}\n`;
      }
    } else {
      md += `🎉 仓库整体健康，暂无需要立即处理的问题。\n`;
    }

    md += `\n---\n> 🤖 由 RepoBeat 自动生成 | ${now}\n`;

    return md;
  }

  /** 根据扫描结果生成建议 */
  _generateRecommendations(git, dep, qual, sec) {
    const recs = [];

    if (!git.commitActivity.isHealthy) {
      recs.push(`⚠️ **提交活跃度偏低** (${git.commitActivity.activityScore}/100)：建议增加提交频率或增加贡献者参与度。`);
    }

    if (git.contributorRisk.riskLevel === "高") {
      recs.push(`⚠️ **贡献者过度集中** (Bus Factor: ${git.contributorRisk.busFactor})：建议知识共享，避免单点依赖。`);
    }

    if (git.branchHealth.staleCount > 5) {
      recs.push(`🗑️ **${git.branchHealth.staleCount} 个过期分支**：建议清理已合并或废弃的分支。`);
    }

    if (dep.totalOutdated > 0) {
      recs.push(`📦 **${dep.totalOutdated} 个过期依赖待更新**：建议定期执行依赖升级，降低安全风险。`);
    }

    if (dep.totalVulnerabilities > 0) {
      recs.push(`🔒 **发现 ${dep.totalVulnerabilities} 个依赖漏洞**：建议立即运行 \`npm audit fix\` 修复。`);
    }

    if (dep.lockFiles.missing.length > 0) {
      recs.push(`🔒 **缺失锁文件** (${dep.lockFiles.missing.join(", ")})：建议提交锁文件到仓库以确保证一致性。`);
    }

    if (qual.codeSmells.totalSmells > 20) {
      recs.push(`🧹 **${qual.codeSmells.totalSmells} 个代码坏味**：建议定期重构，清理调试代码和长函数。`);
    }

    if (qual.duplicates.duplicateGroups > 0) {
      recs.push(`📋 **检测到 ${qual.duplicates.duplicateGroups} 组重复代码**：建议提取公共逻辑。`);
    }

    if (qual.structure.lowCommentFiles.length > 5) {
      recs.push(`📝 **${qual.structure.lowCommentFiles.length} 个文件注释率过低**：对核心模块补充文档注释。`);
    }

    if (sec.criticalCount > 0) {
      recs.push(`🚨 **检测到 ${sec.criticalCount} 个严重密钥泄露**：立即轮换泄露的密钥，从代码中移除！`);
    }

    if (sec.gitignoreStatus.missingPatterns.length > 2) {
      recs.push(`📄 **.gitignore 覆盖不足**：添加敏感文件类型规则以保护凭证文件。`);
    }

    const missingBaseline = sec.baselineChecks.filter((c) => !c.pass);
    if (missingBaseline.length > 0) {
      const items = missingBaseline.map((c) => c.item).join("、");
      recs.push(`📋 **缺少基础设施**：${items}。`);
    }

    return recs;
  }

  /** 保存报告到文件 */
  saveReport(repoName, markdown) {
    const dateStr = new Date().toISOString().split("T")[0];
    const filename = `report-${dateStr}.md`;
    const filepath = path.join(this.reportDir, filename);
    fs.writeFileSync(filepath, markdown, "utf-8");
    return filepath;
  }

  /** 保存历史数据 */
  saveHistory(repoName, scanData) {
    const dateStr = new Date().toISOString().split("T")[0];
    const historyPath = path.join(this.dataDir, "history.json");
    let history = {};
    if (fs.existsSync(historyPath)) {
      history = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
    }

    if (!history[repoName]) history[repoName] = [];
    history[repoName].push({
      date: dateStr,
      ...scanData,
    });

    // 只保留最近 365 条
    if (history[repoName].length > 365) {
      history[repoName] = history[repoName].slice(-365);
    }

    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), "utf-8");
    return history[repoName];
  }

  /** 生成趋势分析 */
  generateTrend(repoName) {
    const historyPath = path.join(this.dataDir, "history.json");
    if (!fs.existsSync(historyPath)) {
      return "暂无历史数据，至少运行两次扫描才能生成趋势分析。\n";
    }

    const history = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
    const records = history[repoName];
    if (!records || records.length < 2) {
      return "历史数据不足（需要至少2次扫描）。\n";
    }

    let md = `## 📈 趋势分析（最近 ${records.length} 次扫描）\n\n`;

    md += `| 日期 | 活跃度 | 依赖 | 安全 |\n`;
    md += `|------|--------|------|------|\n`;
    for (const r of records.slice(-14)) {
      md += `| ${r.date} | ${r.commitActivity?.activityScore || "-"} | ${r.overallHealthScore || "-"} | ${r.securityScore || "-"} |\n`;
    }

    // 趋势方向
    const recent = records.slice(-5);
    if (recent.length >= 2) {
      const first = recent[0];
      const last = recent[recent.length - 1];
      md += `\n### 趋势方向\n\n`;
      md += `- 活跃度: ${first.commitActivity?.activityScore > last.commitActivity?.activityScore ? "📉 下降" : "📈 上升"}\n`;
      md += `- 依赖健康: ${first.overallHealthScore > last.overallHealthScore ? "📉 下降" : "📈 改善"}\n`;
      md += `- 安全评分: ${first.securityScore > last.securityScore ? "📉 下降" : "📈 改善"}\n`;
    }

    return md;
  }
}

module.exports = { Reporter };
