#!/usr/bin/env bash
# Fails if any source file uses a word from the language rule in CLAUDE.md.
# The word list itself lives in lib/language.ts, which is excluded.
set -euo pipefail
cd "$(dirname "$0")/.."

PATTERN='\b(bet|bets|betting|wager|wagers|odds|shares|gamble|gambling|payout|payouts)\b'

hits=$(grep -rniE "$PATTERN" app components lib scripts \
  --include='*.ts' --include='*.tsx' --include='*.json' \
  --exclude='language.ts' --exclude-dir='ui' 2>/dev/null || true)

if [[ -n "$hits" ]]; then
  echo "Language rule violated (see CLAUDE.md). Use belief / confidence / consensus / score instead:"
  echo "$hits"
  exit 1
fi
echo "language lint: ok"
