const fs = require("fs");
const path = require("path");

class SecurityChecker {
  constructor(repoPath) {
    this.repoPath = path.resolve(repoPath);
    this.issues = [];
  }

  /** 扫描敏感信息泄露 */
  scanSecrets() {
    const patterns = [
      { name: "AWS Access Key", regex: /AKIA[0-9A-Z]{16}/gi, severity: "critical" },
      { name: "GitHub Token", regex: /gh[pousr]_[A-Za-z0-9_]{36,}/gi, severity: "critical" },
      { name: "私钥头", regex: /-----BEGIN (RSA|DSA|EC|OPENSSH|PGP) PRIVATE KEY-----/gi, severity: "critical" },
      { name: "Slack Token", regex: /xox[baprs]-[0-9a-zA-Z-]{10,}/gi, severity: "high" },
      { name: "JWT Secret", regex: /eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/gi, severity: "medium" },
      { name: "数据库连接串", regex: /(mongodb|mysql|postgres|redis):\/\/[^\s'"]+/gi, severity: "high" },
      { name: "API Key 模式", regex: /(api[_-]?key|apikey|secret|token|password)\s*[:=]\s*['"][^'"]+['"]/gi, severity: "high" },
    ];

    const findings = [];
    const files = this._listTextFiles();

    for (const file of files) {
      // 跳过 node_modules, .git, dist, build
      if (/node_modules|\.git|dist|build|\.next|vendor/i.test(file)) continue;

      try {
        const content = fs.readFileSync(path.join(this.repoPath, file), "utf-8");
        for (const p of patterns) {
          const matches = content.match(p.regex);
          if (matches) {
            findings.push({
              file,
              pattern: p.name,
              severity: p.severity,
              count: matches.length,
              // 脱敏示例
              sample: matches[0].slice(0, 40) + "...",
            });
          }
        }
      } catch {}
    }

    this.issues.push(...findings);
    return findings;
  }

  /** 检查 .gitignore 是否包含关键文件 */
  checkGitignore() {
    const gitignorePath = path.join(this.repoPath, ".gitignore");
    const criticalPatterns = [
      ".env", ".env.*", "*.pem", "*.key", "credentials.json",
      "secrets.yml", "*.pfx", "id_rsa*", "*.jks",
    ];

    if (!fs.existsSync(gitignorePath)) {
      this.issues.push({
        file: ".gitignore",
        pattern: "缺失 .gitignore",
        severity: "medium",
      });
      return { hasGitignore: false, missingPatterns: criticalPatterns };
    }

    const content = fs.readFileSync(gitignorePath, "utf-8");
    const missing = criticalPatterns.filter((p) => !content.includes(p));

    return { hasGitignore: true, missingPatterns: missing };
  }

  /** 检查文件权限问题 */
  checkFilePermissions() {
    try {
      const out = require("child_process").execSync("git ls-files --stage", {
        cwd: this.repoPath,
        encoding: "utf-8",
        stdio: "pipe",
      });
      const executable = [];
      const lines = out.split("\n").filter(Boolean);
      for (const line of lines) {
        const parts = line.split(/\s+/);
        const mode = parts[0];
        const file = parts[3];
        // 检查是否有可执行权限 (100755)
        if (mode === "100755" && !file.endsWith(".sh") && !file.endsWith(".exe")) {
          executable.push(file);
        }
      }
      return {
        unexpectedExecutables: executable.slice(0, 20),
        count: executable.length,
      };
    } catch {
      return { unexpectedExecutables: [], count: 0 };
    }
  }

  /** 基本安全检查列表 */
  runBaselineChecklist() {
    const checks = [];

    // 检查是否有测试目录
    const hasTestDir = this._hasDir("test", "tests", "__tests__", "spec");
    checks.push({
      item: "测试目录存在",
      pass: hasTestDir,
      severity: hasTestDir ? "ok" : "medium",
    });

    // 检查是否有 CI 配置
    const hasCI = this._hasFile(
      ".github/workflows", ".gitlab-ci.yml", "Jenkinsfile",
      ".travis.yml", "azure-pipelines.yml", ".circleci"
    );
    checks.push({
      item: "CI/CD 配置存在",
      pass: hasCI,
      severity: hasCI ? "ok" : "low",
    });

    // 检查是否有 README
    checks.push({
      item: "README 文档",
      pass: this._hasFile("README.md", "README", "readme.md"),
      severity: "low",
    });

    // 检查是否有 LICENSE
    checks.push({
      item: "开源许可证",
      pass: this._hasFile("LICENSE", "LICENSE.md", "LICENSE.txt"),
      severity: "low",
    });

    // 检查是否有 lock 文件
    checks.push({
      item: "依赖锁定文件",
      pass: this._hasFile("package-lock.json", "yarn.lock", "pnpm-lock.yaml", "Cargo.lock", "Pipfile.lock"),
      severity: "high",
    });

    return checks;
  }

  _listTextFiles() {
    try {
      return require("child_process")
        .execSync("git ls-files", {
          cwd: this.repoPath,
          encoding: "utf-8",
          stdio: "pipe",
        })
        .split("\n")
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  _hasFile(...names) {
    for (const name of names) {
      if (fs.existsSync(path.join(this.repoPath, name))) return true;
    }
    return false;
  }

  _hasDir(...names) {
    for (const name of names) {
      const p = path.join(this.repoPath, name);
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return true;
    }
    return false;
  }

  /** 整体检查 */
  check() {
    const secrets = this.scanSecrets();
    const gitignore = this.checkGitignore();
    const perms = this.checkFilePermissions();
    const baseline = this.runBaselineChecklist();

    const totalIssues = secrets.length + gitignore.missingPatterns.length + perms.count;
    const criticalCount = secrets.filter((s) => s.severity === "critical").length;
    const highCount = secrets.filter((s) => s.severity === "high").length + gitignore.missingPatterns.length;

    let securityScore = 100;
    securityScore -= criticalCount * 25;
    securityScore -= highCount * 10;
    securityScore -= baseline.filter((c) => !c.pass && c.severity === "high").length * 10;
    securityScore = Math.max(0, Math.min(100, securityScore));

    return {
      secretFindings: secrets,
      gitignoreStatus: gitignore,
      filePermissions: perms,
      baselineChecks: baseline,
      totalIssues,
      criticalCount,
      highCount,
      securityScore,
      checkedAt: new Date().toISOString(),
    };
  }
}

module.exports = { SecurityChecker };
