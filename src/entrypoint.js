const { GitScanner } = require("./scanner");
const { DependencyChecker } = require("./dependencies");
const { QualityAnalyzer } = require("./quality");
const { SecurityChecker } = require("./security");
const { Reporter } = require("./reporter");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ─── 读取 GitHub Actions 环境变量 ──────────────────────────────
const repoPath = path.resolve(process.env.REPO_PATH || ".");
const failOnCritical = process.env.FAIL_ON_CRITICAL !== "false";
const failOnScoreBelow = parseInt(process.env.FAIL_ON_SCORE_BELOW || "0", 10);
const commentOnPR = process.env.COMMENT_ON_PR !== "false";
const artifactName = process.env.ARTIFACT_NAME || "repo-health-report";
const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
const eventName = process.env.GITHUB_EVENT_NAME || "";
const isPR = eventName === "pull_request";
const summaryFile = process.env.GITHUB_STEP_SUMMARY;
const outputFile = process.env.GITHUB_OUTPUT;

// ─── 运行扫描 ──────────────────────────────────────────────────
function scan() {
  const scanners = {
    git: new GitScanner(repoPath),
    dep: new DependencyChecker(repoPath),
    qual: new QualityAnalyzer(repoPath),
    sec: new SecurityChecker(repoPath),
  };

  console.log("::group::🔍 Git 活动分析");
  const gitResult = scanners.git.scan();
  console.log(`  活跃度: ${gitResult.commitActivity.activityScore}/100`);
  console.log(`  贡献者: ${gitResult.commitActivity.uniqueAuthors}`);
  console.log(`  过期分支: ${gitResult.branchHealth.staleCount}`);
  console.log("::endgroup::");

  console.log("::group::📦 依赖健康检查");
  const depResult = scanners.dep.check();
  console.log(`  依赖评分: ${depResult.overallHealthScore}/100`);
  console.log(`  过期包: ${depResult.totalOutdated}`);
  console.log(`  漏洞数: ${depResult.totalVulnerabilities}`);
  console.log("::endgroup::");

  console.log("::group::🔬 代码质量分析");
  const qualResult = scanners.qual.analyze();
  console.log(`  文件数: ${qualResult.structure.totalFiles}`);
  console.log(`  代码行: ${qualResult.structure.totalCodeLines}`);
  console.log(`  坏味数: ${qualResult.codeSmells.totalSmells}`);
  console.log("::endgroup::");

  console.log("::group::🔒 安全扫描");
  const secResult = scanners.sec.check();
  console.log(`  安全评分: ${secResult.securityScore}/100`);
  console.log(`  严重: ${secResult.criticalCount}`);
  console.log(`  高风险: ${secResult.highCount}`);
  console.log("::endgroup::");

  return { gitResult, depResult, qualResult, secResult };
}

// ─── 写 Job Summary (GitHub Actions UI) ────────────────────────
function writeSummary(report, scores) {
  if (!summaryFile) return;

  const lines = [];

  // 顶部状态条
  const totalScore = Math.round(
    (scores.activity + scores.dependency + scores.security) / 3
  );
  const statusIcon =
    totalScore >= 80 ? "🟢" : totalScore >= 50 ? "🟡" : "🔴";

  lines.push(`# ${statusIcon} RepoHealth 巡检报告`);
  lines.push("");
  lines.push(`| 维度 | 评分 | 状态 |`);
  lines.push(`|------|------|------|`);
  lines.push(
    `| 开发活跃度 | ${scores.activity}/100 | ${
      scores.activity >= 80 ? "🟢" : scores.activity >= 50 ? "🟡" : "🔴"
    } |`
  );
  lines.push(
    `| 依赖健康 | ${scores.dependency}/100 | ${
      scores.dependency >= 80 ? "🟢" : scores.dependency >= 50 ? "🟡" : "🔴"
    } |`
  );
  lines.push(
    `| 安全评分 | ${scores.security}/100 | ${
      scores.security >= 80 ? "🟢" : scores.security >= 50 ? "🟡" : "🔴"
    } |`
  );
  lines.push("");

  // 关键发现
  lines.push("### 🔑 关键发现");
  lines.push("");

  if (scores.security < 80) {
    const criticalCount = report.sec.criticalCount;
    const highCount = report.sec.highCount;
    if (criticalCount > 0)
      lines.push(
        `- 🚨 **${criticalCount} 个严重安全问题**需立即处理`
      );
    if (highCount > 0)
      lines.push(
        `- ⚠️ ${highCount} 个高风险项建议处理`
      );
  }

  if (report.dep.totalOutdated > 0) {
    lines.push(
      `- 📦 **${report.dep.totalOutdated} 个过期依赖**待更新`
    );
  }

  if (report.dep.totalVulnerabilities > 0) {
    lines.push(
      `- 🔒 发现 **${report.dep.totalVulnerabilities} 个已知漏洞**`
    );
  }

  if (report.git.commitActivity.activityScore < 50) {
    lines.push(
      `- ⚡ 提交活跃度偏低 (${report.git.commitActivity.activityScore}/100)`
    );
  }

  if (report.git.contributorRisk.riskLevel === "高") {
    lines.push(
      `- 👤 Bus Factor 仅 ${report.git.contributorRisk.busFactor}，贡献者过于集中`
    );
  }

  if (report.qual.codeSmells.totalSmells > 0) {
    lines.push(
      `- 🧹 ${report.qual.codeSmells.totalSmells} 个代码坏味`
    );
  }

  lines.push("");
  lines.push("> 🤖 由 [RepoHealth](https://github.com/marketplace/actions/repohealth) 自动生成");

  fs.writeFileSync(summaryFile, lines.join("\n") + "\n", "utf-8");
}

// ─── PR 评论 ───────────────────────────────────────────────────
function postPRComment(scores, report) {
  if (!isPR || !commentOnPR) return;
  if (!process.env.GITHUB_TOKEN) {
    console.log("  未配置 GITHUB_TOKEN，跳过 PR 评论");
    return;
  }

  const total = Math.round(
    (scores.activity + scores.dependency + scores.security) / 3
  );
  const statusIcon =
    total >= 80 ? "✅ 健康" : total >= 50 ? "⚠️ 需关注" : "🔴 有风险";

  const body = [
    `## ${statusIcon} RepoHealth 巡检结果`,
    "",
    `| 维度 | 评分 |`,
    `|------|------|`,
    `| 🏃 开发活跃度 | **${scores.activity}**/100 |`,
    `| 📦 依赖健康 | **${scores.dependency}**/100 |`,
    `| 🔒 安全评分 | **${scores.security}**/100 |`,
    `| **综合** | **${total}**/100 |`,
    "",
  ];

  // 问题速览
  const issues = [];
  if (report.sec.criticalCount > 0)
    issues.push(
      `🚨 ${report.sec.criticalCount} 个严重安全问题`
    );
  if (report.dep.totalVulnerabilities > 0)
    issues.push(
      `🔒 ${report.dep.totalVulnerabilities} 个依赖漏洞`
    );
  if (report.dep.totalOutdated > 0)
    issues.push(
      `📦 ${report.dep.totalOutdated} 个过期包`
    );
  if (report.git.branchHealth.staleCount > 0)
    issues.push(
      `🗑 ${report.git.branchHealth.staleCount} 个过期分支`
    );
  if (report.qual.codeSmells.totalSmells > 5)
    issues.push(
      `🧹 ${report.qual.codeSmells.totalSmells} 个代码坏味`
    );

  if (issues.length > 0) {
    body.push("### ⚡ 需关注");
    body.push("");
    issues.forEach((i) => body.push(`- ${i}`));
  } else {
    body.push("### 🎉 一切正常，没有发现需要关注的问题");
  }

  body.push("");
  body.push("<sub>🤖 由 RepoHealth 自动生成</sub>");

  // 通过 GitHub API 发布评论
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) {
    console.log("  无 event payload，跳过 PR 评论");
    return;
  }

  try {
    const event = JSON.parse(fs.readFileSync(eventPath, "utf-8"));
    const prNumber = event.pull_request?.number || event.number;
    if (!prNumber) {
      console.log("  非 PR 事件，跳过评论");
      return;
    }

    const [owner, repo] = (process.env.GITHUB_REPOSITORY || "").split("/");
    if (!owner || !repo) return;

    // 用 gh CLI 发评论（GitHub Actions 预装）
    const { execSync } = require("child_process");
    const tmpFile = path.join(os.tmpdir(), "repohealth-pr-comment.md");
    fs.writeFileSync(tmpFile, body.join("\n"), "utf-8");

    execSync(
      `gh pr comment ${prNumber} --body-file "${tmpFile}" --repo ${owner}/${repo}`,
      {
        env: { ...process.env, GH_TOKEN: process.env.GITHUB_TOKEN },
        encoding: "utf-8",
        stdio: "pipe",
      }
    );
    console.log(`  ✅ 已发布 PR 评论 (#${prNumber})`);
  } catch (err) {
    console.log(`  发布 PR 评论失败: ${err.message}`);
    // 回退：直接打印到日志
    console.log(body.join("\n"));
  }
}

// ─── 写输出变量 ─────────────────────────────────────────────────
function writeOutputs(scores, reportFile) {
  if (!outputFile) return;
  const kv = [
    `activity-score=${scores.activity}`,
    `dependency-score=${scores.dependency}`,
    `security-score=${scores.security}`,
    `report-file=${reportFile}`,
  ].join("\n");
  fs.writeFileSync(outputFile, kv + "\n", "utf-8");
}

// ─── 主流程 ─────────────────────────────────────────────────────
function main() {
  console.log(`🚀 RepoHealth 启动`);
  console.log(`  仓库路径: ${repoPath}`);
  console.log(`  事件类型: ${eventName}`);
  console.log(`  PR 模式: ${isPR ? "是" : "否"}`);

  // 1. 扫描
  const { gitResult, depResult, qualResult, secResult } = scan();

  // 2. 生成报告
  const repoName =
    process.env.GITHUB_REPOSITORY?.split("/")[1] ||
    path.basename(repoPath);

  const reportDir = path.join(workspace, "repo-health-output");
  const dataDir = path.join(reportDir, "data");
  const reporter = new Reporter(reportDir, dataDir);
  const markdown = reporter.generate(
    repoName,
    gitResult,
    depResult,
    qualResult,
    secResult
  );
  const reportFile = reporter.saveReport(repoName, markdown);
  console.log(`  ✅ 完整报告: ${reportFile}`);

  // 3. 写 Job Summary
  const scores = {
    activity: gitResult.commitActivity.activityScore,
    dependency: depResult.overallHealthScore,
    security: secResult.securityScore,
  };
  writeSummary({ git: gitResult, dep: depResult, qual: qualResult, sec: secResult }, scores);

  // 4. PR 评论
  postPRComment(scores, {
    git: gitResult,
    dep: depResult,
    qual: qualResult,
    sec: secResult,
  });

  // 5. 写输出变量
  writeOutputs(scores, reportFile);

  // 6. 检查失败阈值
  let hasFailure = false;

  if (failOnCritical && secResult.criticalCount > 0) {
    console.error(
      `::error::发现 ${secResult.criticalCount} 个严重安全问题，Pipeline 失败`
    );
    hasFailure = true;
  }

  if (
    failOnScoreBelow > 0 &&
    (scores.activity < failOnScoreBelow ||
      scores.dependency < failOnScoreBelow ||
      scores.security < failOnScoreBelow)
  ) {
    console.error(
      `::error::健康评分不达标 (阈值: ${failOnScoreBelow})，Pipeline 失败`
    );
    hasFailure = true;
  }

  if (hasFailure) process.exit(1);

  console.log("✅ RepoHealth 巡检完成");
}

module.exports = { main };

if (require.main === module) main();
