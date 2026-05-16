#!/bin/bash
# RepoHealth 自动巡检脚本 — 配合 crontab 使用
cd "$(dirname "$0")"
node src/index.js
