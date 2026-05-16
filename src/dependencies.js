const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

class DependencyChecker {
  constructor(repoPath) {
    this.repoPath = path.resolve(repoPath);
    this.results = { npm: null, pip: null, cargo: null };
  }

  _findFile(...names) {
    for (const name of names) {
      const p = path.join(this.repoPath, name);
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  /** 检查 Node.js 项目依赖 */
  checkNPM() {
    const pkgPath = this._findFile("package.json");
    if (!pkgPath) return null;

    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    const result = {
      totalDeps: Object.keys(deps).length,
      outdated: [],
      auditIssues: { low: 0, moderate: 0, high: 0, critical: 0 },
    };

    // npm outdated (如果 npm 可用)
    try {
      const out = execSync("npm outdated --json", {
        cwd: this.repoPath,
        encoding: "utf-8",
        stdio: "pipe",
      });
      const outdated = JSON.parse(out);
      for (const [name, info] of Object.entries(outdated)) {
        result.outdated.push({
          name,
          current: info.current,
          wanted: info.wanted,
          latest: info.latest,
        });
      }
    } catch (e) {
      // npm outdated 在无过期包时返回非零退出码
      if (e.stdout) {
        try {
          const outdated = JSON.parse(e.stdout);
          for (const [name, info] of Object.entries(outdated)) {
            result.outdated.push({
              name,
              current: info.current,
              wanted: info.wanted,
              latest: info.latest,
            });
          }
        } catch {}
      }
    }

    // npm audit
    try {
      const auditOut = execSync("npm audit --json", {
        cwd: this.repoPath,
        encoding: "utf-8",
        stdio: "pipe",
      });
      const audit = JSON.parse(auditOut);
      if (audit.metadata?.vulnerabilities) {
        const v = audit.metadata.vulnerabilities;
        result.auditIssues = {
          low: v.low || 0,
          moderate: v.moderate || 0,
          high: v.high || 0,
          critical: v.critical || 0,
        };
      }
    } catch (e) {
      if (e.stdout) {
        try {
          const audit = JSON.parse(e.stdout);
          if (audit.metadata?.vulnerabilities) {
            const v = audit.metadata.vulnerabilities;
            result.auditIssues = {
              low: v.low || 0,
              moderate: v.moderate || 0,
              high: v.high || 0,
              critical: v.critical || 0,
            };
          }
        } catch {}
      }
    }

    result.healthScore = this._scoreNPM(result);
    return result;
  }

  _scoreNPM(r) {
    let score = 100;
    score -= r.outdated.length * 5;
    score -= r.auditIssues.low * 1;
    score -= r.auditIssues.moderate * 3;
    score -= r.auditIssues.high * 10;
    score -= r.auditIssues.critical * 25;
    return Math.max(0, Math.min(100, score));
  }

  /** 检查 Python 项目依赖 */
  checkPip() {
    const reqPath = this._findFile("requirements.txt", "requirements-dev.txt");
    if (!reqPath) return null;
    const content = fs.readFileSync(reqPath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith("-"));

    const deps = lines.map((l) => {
      const pkg = l.split("==")[0].split(">=")[0].split("<")[0].split("~=")[0].trim();
      return pkg;
    });

    // 简单解析版本钉住情况
    const pinned = lines.filter((l) => l.includes("==")).length;
    const unpinned = lines.length - pinned;

    return {
      totalDeps: deps.length,
      pinned,
      unpinned,
      outdated: [], // pip 需要额外工具，这里只做基本检查
      auditIssues: { low: 0, moderate: 0, high: 0, critical: 0 },
      healthScore: unpinned > 0 ? Math.max(0, 100 - unpinned * 10) : 100,
      note: "Python 依赖检查仅限版本钉住状态。建议使用 pip-audit 或 safety 进行完整漏洞扫描。",
    };
  }

  /** 检查 Rust 项目 */
  checkCargo() {
    const cargoPath = this._findFile("Cargo.toml");
    if (!cargoPath) return null;
    try {
      const out = execSync("cargo outdated --format json 2>/dev/null || true", {
        cwd: this.repoPath,
        encoding: "utf-8",
        stdio: "pipe",
      }).trim();
      if (out) return JSON.parse(out);
    } catch {}
    return { totalDeps: 0, outdated: [], healthScore: 100, note: "无法运行 cargo outdated" };
  }

  /** 检查 lock 文件是否存在 */
  checkLockFiles() {
    const locks = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "Cargo.lock", "Pipfile.lock"];
    const found = [];
    const missing = [];
    for (const lock of locks) {
      if (fs.existsSync(path.join(this.repoPath, lock))) {
        found.push(lock);
      } else if (this._hasCorrespondingEcosystem(lock)) {
        missing.push(lock);
      }
    }
    return { found, missing };
  }

  _hasCorrespondingEcosystem(lock) {
    const map = {
      "package-lock.json": "package.json",
      "yarn.lock": "package.json",
      "pnpm-lock.yaml": "package.json",
      "Cargo.lock": "Cargo.toml",
      "Pipfile.lock": "Pipfile",
    };
    return fs.existsSync(path.join(this.repoPath, map[lock]));
  }

  /** 整体检查 */
  check() {
    const npm = this.checkNPM();
    const pip = this.checkPip();
    const cargo = this.checkCargo();
    const lockFiles = this.checkLockFiles();

    const results = {};
    if (npm) results.npm = npm;
    if (pip) results.pip = pip;
    if (cargo) results.cargo = cargo;

    let overallScore = 100;
    if (npm) overallScore = Math.min(overallScore, npm.healthScore);
    if (pip) overallScore = Math.min(overallScore, pip.healthScore);

    return {
      scanners: results,
      lockFiles,
      overallHealthScore: overallScore,
      totalOutdated: (npm?.outdated?.length || 0) + (pip?.outdated?.length || 0),
      totalVulnerabilities: npm
        ? Object.values(npm.auditIssues).reduce((a, b) => a + b, 0)
        : 0,
      checkedAt: new Date().toISOString(),
    };
  }
}

module.exports = { DependencyChecker };
