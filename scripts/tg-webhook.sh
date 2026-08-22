#!/usr/bin/env bash
# Point the Telegram bot at this deployment's webhook.
#   ./scripts/tg-webhook.sh set     — register (reads secrets from .dev.vars)
#   ./scripts/tg-webhook.sh info    — show current registration and last error
#   ./scripts/tg-webhook.sh delete  — unregister
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .dev.vars ] || { echo "missing .dev.vars"; exit 1; }

TOKEN=$(grep '^TELEGRAM_BOT_TOKEN=' .dev.vars | cut -d= -f2-)
SECRET=$(grep '^TELEGRAM_WEBHOOK_SECRET=' .dev.vars | cut -d= -f2-)
WORKER=$(python3 -c "import json,re,sys;s=open('wrangler.jsonc').read();s=re.sub(r'//.*','',s);print(json.loads(s)['name'])")
URL="https://${WORKER}.iamabhimanyu08.workers.dev/api/telegram/webhook"

case "${1:-info}" in
  set)
    curl -sS -X POST "https://api.telegram.org/bot$TOKEN/setWebhook" \
      -H 'content-type: application/json' \
      -d "{\"url\":\"$URL\",\"secret_token\":\"$SECRET\",\"allowed_updates\":[\"message\"],\"drop_pending_updates\":true}" \
      | python3 -m json.tool
    ;;
  delete)
    curl -sS -X POST "https://api.telegram.org/bot$TOKEN/deleteWebhook" | python3 -m json.tool
    ;;
  info)
    curl -sS "https://api.telegram.org/bot$TOKEN/getWebhookInfo" | python3 -m json.tool
    ;;
  *) echo "usage: $0 {set|info|delete}"; exit 1 ;;
esac
