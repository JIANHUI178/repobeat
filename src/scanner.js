const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

class GitScanner {
  constructor(repoPath) {
    this.repoPath = path.resolve(repoPath);
    this._verifyGit();
  }

  _verifyGit() {
    try {
      execSync("git rev-parse --git-dir", { cwd: this.repoPath, stdio: "pipe" });
    } catch {
      throw new Error(`${this.repoPath} 不是有效的 Git 仓库`);
    }
  }

  _exec(args) {
    return execSync(`git ${args}`, {
      cwd: this.repoPath,
      encoding: "utf-8",
      stdio: "pipe",
      maxBuffer: 50 * 1024 * 1024,
    }).trim();
  }

  /** 提交频率分析 */
  getCommitActivity(days = 90) {
    const since = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];

    const log = this._exec(
      `log --since="${since}" --format="%H|%an|%ad|%s" --date=short`
    );
    const commits = log
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, author, date, ...msg] = line.split("|");
        return { hash: hash.slice(0, 8), author, date, message: msg.join("|") };
      });

    // 按天统计
    const byDay = {};
    const byAuthor = {};
    for (const c of commits) {
      byDay[c.date] = (byDay[c.date] || 0) + 1;
      byAuthor[c.author] = (byAuthor[c.author] || 0) + 1;
    }

    // 活跃度评分 0-100
    const dailyAvg = commits.length / days;
    const activeDays = Object.keys(byDay).length;
    const consistency = activeDays / days; // 提交天数占比
    const authorCount = Object.keys(byAuthor).length;

    let score = 0;
    score += Math.min(dailyAvg * 40, 40); // 频率分
    score += consistency * 30;              // 一致性分
    score += Math.min(authorCount * 6, 30); // 团队规模分

    return {
      period: `${days}天`,
      totalCommits: commits.length,
      avgPerDay: +dailyAvg.toFixed(2),
      activeDays,
      consistency: +(consistency * 100).toFixed(1),
      uniqueAuthors: authorCount,
      topAuthors: Object.entries(byAuthor)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => ({ name, count })),
      activityScore: Math.round(score),
      isHealthy: score >= 50,
    };
  }

  /** 代码量统计 */
  getCodeStats() {
    // 按文件类型统计行数
    const out = this._exec("ls-files");
    const files = out.split("\n").filter(Boolean);
    const stats = { totalFiles: files.length, totalLines: 0, byType: {} };

    for (const f of files) {
      const ext = path.extname(f).slice(1) || "other";
      try {
        const lines = this._exec(`log --oneline -- "${f}"`).split("\n").length || 1;
        stats.totalLines += lines;
        if (!stats.byType[ext]) stats.byType[ext] = { files: 0, lines: 0 };
        stats.byType[ext].files++;
        stats.byType[ext].lines += lines;
      } catch {
        // 二进制文件跳过
      }
    }

    return stats;
  }

  /** 文件大小分析 — 发现大文件 */
  findLargeFiles(thresholdKB = 500) {
    const out = this._exec("ls-files");
    const files = out.split("\n").filter(Boolean);
    const large = [];

    for (const f of files) {
      try {
        const fullPath = path.join(this.repoPath, f);
        if (fs.existsSync(fullPath)) {
          const stat = fs.statSync(fullPath);
          if (stat.size > thresholdKB * 1024) {
            large.push({
              file: f,
              sizeKB: Math.round(stat.size / 1024),
              lineCount: this._getLineCount(f),
            });
          }
        }
      } catch { /* skip */ }
    }

    return {
      thresholdKB,
      largeFileCount: large.length,
      largeFiles: large
        .sort((a, b) => b.sizeKB - a.sizeKB)
        .slice(0, 10),
    };
  }

  _getLineCount(file) {
    try {
      return parseInt(this._exec(`log --oneline -- "${file}" | wc -l`)) || 0;
    } catch {
      try {
        const content = fs.readFileSync(path.join(this.repoPath, file), "utf-8");
        return content.split("\n").length;
      } catch {
        return 0;
      }
    }
  }

  /** 分支健康度 */
  getBranchHealth() {
    // 获取所有本地分支名称
    const branchNames = this._exec("branch")
      .split("\n")
      .filter(Boolean)
      .map((l) => l.replace(/^\*?\s+/, ""));

    // 逐个获取最后提交日期
    const branches = branchNames.map((name) => {
      try {
        const date = execSync(`git log -1 --format="%cs" "${name}" --`, {
          cwd: this.repoPath, encoding: "utf-8", stdio: "pipe",
        }).trim();
        return { name, lastCommitDate: date || "未知" };
      } catch {
        return { name, lastCommitDate: "未知" };
      }
    });

    const current = this._exec("rev-parse --abbrev-ref HEAD");

    // 检测过期分支（超过90天未提交）
    const staleThreshold = new Date(Date.now() - 90 * 86400000);
    const staleBranches = branches.filter((b) => {
      if (b.lastCommitDate === "未知") return false;
      return new Date(b.lastCommitDate) < staleThreshold;
    });

    return {
      totalBranches: branches.length,
      currentBranch: current,
      staleBranches: staleBranches.map((b) => b.name),
      staleCount: staleBranches.length,
    };
  }

  /** 贡献者集中度风险 (0-1，越高越集中) */
  getContributorRisk() {
    const log = this._exec('log --format="%an" --since="180 days ago"');
    const authors = log.split("\n").filter(Boolean);
    const total = authors.length;
    if (total === 0) return { risk: 0, busFactor: 0, details: [] };

    const count = {};
    for (const a of authors) count[a] = (count[a] || 0) + 1;

    const sorted = Object.entries(count).sort((a, b) => b[1] - a[1]);
    // 检查前两名贡献者的集中度
    const top2Ratio = sorted.slice(0, 2).reduce((s, [, c]) => s + c, 0) / total;
    // 巴士因子：多少贡献者合计超过50%
    let acc = 0;
    let busFactor = 0;
    for (const [, c] of sorted) {
      acc += c;
      busFactor++;
      if (acc / total >= 0.5) break;
    }

    return {
      risk: +top2Ratio.toFixed(2),
      busFactor,
      riskLevel: top2Ratio > 0.7 ? "高" : top2Ratio > 0.5 ? "中" : "低",
      topContributors: sorted.slice(0, 5).map(([name, commits]) => ({
        name,
        commits,
        percentage: +((commits / total) * 100).toFixed(1),
      })),
    };
  }

  /** 未跟踪文件数量 */
  getUntrackedCount() {
    try {
      const out = this._exec("ls-files --others --exclude-standard");
      const files = out.split("\n").filter(Boolean);
      return files.length;
    } catch {
      return 0;
    }
  }

  /** 整体扫描 */
  scan() {
    return {
      commitActivity: this.getCommitActivity(90),
      contributorRisk: this.getContributorRisk(),
      branchHealth: this.getBranchHealth(),
      largeFiles: this.findLargeFiles(),
      untrackedFiles: this.getUntrackedCount(),
      scannedAt: new Date().toISOString(),
    };
  }
}

module.exports = { GitScanner };
