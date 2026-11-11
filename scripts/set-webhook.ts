import { getEnv } from "@/lib/env";
import { getWebhookInfo, setMyCommands, setWebhook } from "@/server/telegram/api";

/**
 * PLAN �?7.3 / �?14: register the HTTPS webhook with `secret_token` and set the
 * bot command list. Prints the resulting webhook state without secrets.
 */
async function main(): Promise<void> {
  const env = getEnv();
  const url = env.TELEGRAM_WEBHOOK_URL;
  const secret = env.WEBHOOK_SECRET;

  if (!env.BOT_TOKEN) {
    console.error("BOT_TOKEN is required");
    process.exit(1);
    return;
  }
  if (!url) {
    console.error("TELEGRAM_WEBHOOK_URL is required (for example https://app.example.com/api/webhook/telegram)");
    process.exit(1);
    return;
  }
  if (!secret) {
    console.error("WEBHOOK_SECRET is required");
    process.exit(1);
    return;
  }

  await setWebhook(url, secret);
  await setMyCommands([
    { command: "start", description: "Open Earn Money" },
    { command: "app", description: "Launch the Mini App" },
    { command: "balance", description: "Show your coin balance" },
    { command: "help", description: "How the game works" },
  ]);

  const info = await getWebhookInfo();
  const safe = {
    url: typeof info.url === "string" ? info.url : undefined,
    pending_update_count: info.pending_update_count,
    last_error_date: info.last_error_date,
    last_error_message: info.last_error_message,
    max_connections: info.max_connections,
    ip_address: info.ip_address,
  };
  console.log(JSON.stringify({ level: "info", message: "webhook_configured", webhook: safe }));
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      level: "error",
      message: "webhook_setup_failed",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
