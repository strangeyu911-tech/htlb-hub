#!/usr/bin/env bash
# 取上游数据 → 写到 htlb-hub/.cache/ 下的两个文件，供 verify-upstream.mjs 读取。
# 用法: bash htlb-hub/fetch-upstream.sh
#
# 为什么要单独一个 shell 脚本：本机沙箱里 node 起子进程会 EBUSY（git.exe 绝对路径也一样），
# 所以 git 只能在 shell 里跑；而 GitHub Actions 里同样跑这个脚本，两边行为一致。
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE="$DIR/.cache"
UPSTREAM="${HTLB_UPSTREAM_DIR:-$CACHE/upstream}"
REPO="https://github.com/eternity4719/HowToLiveBetter.git"

mkdir -p "$CACHE"

REF="origin/main"
# ⚠️ core.quotepath=false 是必须的：book/ 下全是中文文件名（如 `book/01-不要早死.md`），
#    默认 quotepath=true 会把路径写成 "b/book/\346\226\207..." → 解析器按 `+++ b/` 匹配会全部落空，
#    表现为 bookFiles=0、fork 对比策略直接失效（2026-10-13 踩过）。
QUOTEPATH="-c core.quotepath=false"

if [ ! -d "$UPSTREAM/.git" ]; then
  # ⚠️ 不要用 --filter=blob:none！仓库总共才 ~18 MB，而 blobless 会让
  #    `git log -p -- book/` 触发「逐 blob 按需 fetch」（进程表现为
  #    `git fetch origin --filter=blob:none --stdin`），在本机会挂住十几分钟
  #    且产出的 patch 是截断的 —— 时间线会被静默写坏（2026-10-13 实证：
  #    累积条目数只剩 614、历史只到 9-28）。完整 clone 只要几秒。
  echo "== 克隆上游（完整 clone，~18 MB）"
  git clone --no-checkout "$REPO" "$UPSTREAM"
else
  echo "== 更新上游"
  git -C "$UPSTREAM" fetch origin main --quiet
fi

echo "== 导出 book/ 全量历史 patch"
git -C "$UPSTREAM" $QUOTEPATH log --reverse -U0 -p --format='@@@%H|%ci|%s' $REF -- book/ > "$CACHE/upstream-book.patch"
echo "   $(wc -c < "$CACHE/upstream-book.patch") B"

echo "== 导出全部 commit 的 sha|日期"
git -C "$UPSTREAM" log --format='%H|%ci' $REF > "$CACHE/upstream-commits.txt"
echo "   $(wc -l < "$CACHE/upstream-commits.txt") 条"

echo "== 导出 book/ 当前文件清单（fork 逐文件对比用，比从 patch 反推可靠）"
git -C "$UPSTREAM" $QUOTEPATH ls-tree -r --name-only $REF -- book/ > "$CACHE/upstream-bookfiles.txt"
echo "   $(wc -l < "$CACHE/upstream-bookfiles.txt") 个文件"

echo "== HEAD"
git -C "$UPSTREAM" log -1 --format='%H  %ci  %s' $REF

echo "完成 → $CACHE"
