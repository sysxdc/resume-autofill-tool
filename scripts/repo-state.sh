#!/usr/bin/env bash
# 多会话/多 agent 协作前的仓库体检：一眼看清「现在这个 checkout 是谁的、有没有别人的活没合」。
#
# 背景：本仓库曾被两个会话在同一个 checkout 上交替提交（v1.5.14–1.5.16 与我这几轮的提交
# 混在一个 HEAD 历史里）。那不会丢代码，但会让人误以为自己在改的文件「莫名其妙变了」，
# 也让「合并推送」变成猜谜。开工前跑一下这个脚本，30 秒能省掉一次回滚。
#
# 用法：bash scripts/repo-state.sh
set -u
cd "$(dirname "$0")/.." || exit 1

echo "== 当前分支 =="
git status -sb | head -1

echo
echo "== 与远端的关系 =="
git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' >/dev/null 2>&1 \
  && git status -sb | head -1 \
  || echo "  （没有 upstream：还没 push 过）"

echo
echo "== 未提交改动 =="
dirty=$(git status --porcelain | wc -l | tr -d ' ')
if [ "$dirty" = "0" ]; then
  echo "  干净"
else
  echo "  $dirty 个文件有改动："
  git status --porcelain | head -10 | sed 's/^/    /'
fi

echo
echo "== 工作树（worktree）=="
git worktree list | sed 's/^/  /'

echo
echo "== 锁文件 =="
locks=$(ls .git/*.lock .git/refs/**/*.lock 2>/dev/null | head -5)
[ -n "$locks" ] && echo "$locks" | sed 's/^/  /' || echo "  无"

echo
echo "== 领先 main 的分支（= 有活没合进来）=="
any=0
for b in $(git for-each-ref --format='%(refname:short)' refs/heads); do
  [ "$b" = "main" ] && continue
  ahead=$(git rev-list --count "main..$b" 2>/dev/null || echo 0)
  if [ "$ahead" != "0" ]; then
    any=1
    printf "  %-28s ahead=%s  %s\n" "$b" "$ahead" "$(git log -1 --format='%cr %s' "$b" | cut -c1-56)"
  fi
done
[ "$any" = "0" ] && echo "  无（所有分支都已并入 main）"

echo
echo "== 最近 5 条提交 =="
git log --oneline -5 | sed 's/^/  /'

echo
echo "== stash =="
st=$(git stash list | wc -l | tr -d ' ')
[ "$st" = "0" ] && echo "  空" || git stash list | sed 's/^/  /'

cat <<'TIP'

判读建议：
  · 有别的 worktree 指向同一个 .git → 另一个会话可能正在写，先协调再用
  · .git/*.lock 存在 → 有人正在提交/切分支，等它结束，别硬删锁
  · 有分支 ahead main → 别人的活还没合，先看内容再决定合并顺序
  · HEAD 的父提交不是你自己上一条 → 这个 checkout 被别的会话推进过，重新确认改动范围
TIP
