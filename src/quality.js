const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

class QualityAnalyzer {
  constructor(repoPath) {
    this.repoPath = path.resolve(repoPath);
  }

  /** 获取所有源码文件 */
  _getSourceFiles(extensions = null) {
    try {
      const out = execSync("git ls-files", {
        cwd: this.repoPath,
        encoding: "utf-8",
        stdio: "pipe",
      });
      const all = out.split("\n").filter(Boolean);
      const codeExts = extensions || [
        "js", "ts", "jsx", "tsx", "py", "rs", "go", "java", "rb", "php",
        "c", "cpp", "h", "hpp", "swift", "kt", "scala", "css", "scss", "html",
        "vue", "svelte", "yml", "yaml", "json", "md", "sh", "sql",
      ];
      return all.filter((f) => {
        const ext = path.extname(f).slice(1);
        return codeExts.includes(ext);
      });
    } catch {
      return [];
    }
  }

  /** 统计所有文件的代码行数（排除空行和注释行） */
  analyzeStructure() {
    const files = this._getSourceFiles();
    const fileList = [];

    for (const file of files) {
      const fullPath = path.join(this.repoPath, file);
      try {
        const content = fs.readFileSync(fullPath, "utf-8");
        const lines = content.split("\n");
        const blank = lines.filter((l) => !l.trim()).length;
        const comment = lines.filter((l) => {
          const t = l.trim();
          return (
            t.startsWith("//") || t.startsWith("#") || t.startsWith("/*") ||
            t.startsWith("*") || t.startsWith("<!--") || t === "*/"
          );
        }).length;
        const code = Math.max(0, lines.length - blank - comment);
        fileList.push({
          file,
          totalLines: lines.length,
          codeLines: code,
          commentLines: comment,
          blankLines: blank,
          commentRatio: +(comment / Math.max(code, 1)).toFixed(2),
        });
      } catch {
        // 跳过不可读文件
      }
    }

    // 按代码行数排序
    fileList.sort((a, b) => b.codeLines - a.codeLines);

    // 按目录统计
    const byDir = {};
    for (const f of fileList) {
      const dir = path.dirname(f.file).split(path.sep)[0] || "root";
      if (!byDir[dir]) byDir[dir] = { files: 0, codeLines: 0 };
      byDir[dir].files++;
      byDir[dir].codeLines += f.codeLines;
    }

    return {
      totalFiles: fileList.length,
      totalCodeLines: fileList.reduce((s, f) => s + f.codeLines, 0),
      totalCommentLines: fileList.reduce((s, f) => s + f.commentLines, 0),
      totalBlankLines: fileList.reduce((s, f) => s + f.blankLines, 0),
      avgFileSize: fileList.length
        ? Math.round(fileList.reduce((s, f) => s + f.codeLines, 0) / fileList.length)
        : 0,
      top10Largest: fileList.slice(0, 10).map((f) => ({
        file: f.file,
        codeLines: f.codeLines,
      })),
      lowCommentFiles: fileList
        .filter((f) => f.codeLines > 50 && f.commentRatio < 0.05)
        .slice(0, 10)
        .map((f) => ({ file: f.file, commentRatio: f.commentRatio })),
      byDirectory: byDir,
    };
  }

  /** 检测重复代码（简单基于文件哈希的前 N 行相似度） */
  detectDuplicates() {
    const files = this._getSourceFiles(["js", "ts", "jsx", "tsx", "py", "rs", "go", "java"]);
    const signatures = {};

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(this.repoPath, file), "utf-8");
        const lines = content.split("\n").filter((l) => {
          const t = l.trim();
          return t && !t.startsWith("//") && !t.startsWith("#") && t !== "{";
        });

        // 取前20行有效代码作为签名
        const sig = lines.slice(0, 20).map((l) => l.trim()).join("\n");
        if (sig.length > 50) {
          if (!signatures[sig]) signatures[sig] = [];
          signatures[sig].push(file);
        }
      } catch {}
    }

    const duplicates = Object.entries(signatures)
      .filter(([, fs]) => fs.length > 1)
      .map(([, fs]) => ({ files: fs, count: fs.length }));

    return {
      duplicateGroups: duplicates.length,
      filesInDuplicates: duplicates.reduce((s, d) => s + d.count, 0),
      details: duplicates.slice(0, 10),
    };
  }

  /** 检测常见代码坏味 */
  detectCodeSmells() {
    const files = this._getSourceFiles(["js", "ts", "jsx", "tsx", "py"]);
    const smells = [];

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(this.repoPath, file), "utf-8");
        const lines = content.split("\n");

        // 过长的函数（连续缩进行超过 100 行）
        let consecutiveIndented = 0;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith("  ") || lines[i].startsWith("\t")) {
            consecutiveIndented++;
          } else {
            if (consecutiveIndented > 100) {
              smells.push({
                file,
                line: i - consecutiveIndented + 1,
                type: "过长函数",
                detail: `连续 ${consecutiveIndented} 行缩进代码`,
              });
            }
            consecutiveIndented = 0;
          }
        }

        // 检测 TODO/FIXME/HACK 数量
        const todoCount = (content.match(/\/\/\s*TODO|#\s*TODO|<!--\s*TODO/gi) || []).length;
        const fixmeCount = (content.match(/\/\/\s*FIXME|#\s*FIXME/gi) || []).length;
        const hackCount = (content.match(/\/\/\s*HACK|#\s*HACK/gi) || []).length;
        if (todoCount + fixmeCount + hackCount > 5) {
          smells.push({
            file,
            line: 1,
            type: "过多未解决标记",
            detail: `TODO:${todoCount} FIXME:${fixmeCount} HACK:${hackCount}`,
          });
        }

        // 检测 console.log / print 调试残留
        const debugLines = [];
        for (let i = 0; i < lines.length; i++) {
          const t = lines[i].trim();
          if (t.match(/console\.(log|debug|warn)\(/) || t.match(/^\s*print\(/)) {
            debugLines.push(i + 1);
          }
        }
        if (debugLines.length > 3) {
          smells.push({
            file,
            line: debugLines[0],
            type: "调试代码残留",
            detail: `${debugLines.length} 处 console.log/print`,
          });
        }
      } catch {}
    }

    return {
      totalSmells: smells.length,
      smells,
      severity: smells.length > 50 ? "严重" : smells.length > 20 ? "警告" : "良好",
    };
  }

  /** 整体分析 */
  analyze() {
    return {
      structure: this.analyzeStructure(),
      duplicates: this.detectDuplicates(),
      codeSmells: this.detectCodeSmells(),
      analyzedAt: new Date().toISOString(),
    };
  }
}

module.exports = { QualityAnalyzer };
