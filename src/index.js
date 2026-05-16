const { GitScanner } = require("./scanner");
const { DependencyChecker } = require("./dependencies");
const { QualityAnalyzer } = require("./quality");
const { SecurityChecker } = require("./security");
const { Reporter } = require("./reporter");
const fs = require("fs");
const path = require("path");

class RepoHealth {
  constructor(configPath = null) {
    this.configPath = configPath || path.join(__dirname, "..", "config.json");
    this.config = JSON.parse(fs.readFileSync(this.configPath, "utf-8"));
  }

  /** 扫描单个仓库 */
  async scanRepo(repoConfig) {
    const { name, path: repoPath } = repoConfig;
    console.log(`\n🔍 正在扫描: ${name} (${repoPath})`);

    const scanner = new GitScanner(repoPath);
    const depChecker = new DependencyChecker(repoPath);
    const quality = new QualityAnalyzer(repoPath);
    const security = new SecurityChecker(repoPath);

    console.log("  ├─ Git 活动分析...");
    const scanResult = scanner.scan();

    console.log("  ├─ 依赖健康检查...");
    const depResult = depChecker.check();

    console.log("  ├─ 代码质量分析...");
    const qualityResult = quality.analyze();

    console.log("  ├─ 安全扫描...");
    const securityResult = security.check();

    return { scanResult, depResult, qualityResult, securityResult };
  }

  /** 运行完整巡检 */
  async run(options = {}) {
    const { config } = this;
    const reporter = new Reporter(config.output.reportDir, config.output.dataDir);

    const enabledRepos = config.repositories.filter((r) => r.enabled);
    const results = [];

    for (const repo of enabledRepos) {
      try {
        const data = await this.scanRepo(repo);

        // 生成报告
        const markdown = reporter.generate(
          repo.name,
          data.scanResult,
          data.depResult,
          data.qualityResult,
          data.securityResult
        );

        const reportPath = reporter.saveReport(repo.name, markdown);
        console.log(`  └─ ✅ 报告已保存: ${reportPath}`);

        // 保存历史
        const summary = {
          commitActivity: data.scanResult.commitActivity,
          overallHealthScore: data.depResult.overallHealthScore,
          securityScore: data.securityResult.securityScore,
          totalOutdated: data.depResult.totalOutdated,
          totalVulnerabilities: data.depResult.totalVulnerabilities,
          codeSmells: data.qualityResult.codeSmells.totalSmells,
        };
        reporter.saveHistory(repo.name, summary);

        // 趋势分析
        if (!options.noTrend) {
          const trend = reporter.generateTrend(repo.name);
          const trendPath = path.join(config.output.reportDir, `trend-${repo.name}.md`);
          fs.writeFileSync(trendPath, trend, "utf-8");
        }

        results.push({ repo: repo.name, reportPath, status: "ok" });
      } catch (err) {
        console.error(`  └─ ❌ 扫描失败: ${err.message}`);
        results.push({ repo: repo.name, error: err.message, status: "error" });
      }
    }

    // 打印汇总
    console.log("\n" + "=".repeat(60));
    console.log("📊 巡检汇总");
    console.log("=".repeat(60));
    for (const r of results) {
      const icon = r.status === "ok" ? "✅" : "❌";
      console.log(`${icon} ${r.repo}: ${r.status === "ok" ? r.reportPath : r.error}`);
    }

    return results;
  }
}

// CLI 入口
async function main() {
  const args = process.argv.slice(2);
  const reportOnly = args.includes("--report-only") || args.includes("-r");

  const health = new RepoHealth();

  if (reportOnly) {
    // 仅基于已有数据生成趋势报告
    const reporter = new Reporter(health.config.output.reportDir, health.config.output.dataDir);
    for (const repo of health.config.repositories.filter((r) => r.enabled)) {
      const trend = reporter.generateTrend(repo.name);
      console.log(trend);
    }
    return;
  }

  await health.run();
}

if (require.main === module) {
  main().catch((err) => {
    console.error("巡检失败:", err.message);
    process.exit(1);
  });
}

module.exports = { RepoHealth };
