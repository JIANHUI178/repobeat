@echo off
REM  RepoHealth 自动巡检脚本 — 配合 Windows 任务计划程序使用
cd /d "d:\流水线1\repo-health"
node src/index.js
