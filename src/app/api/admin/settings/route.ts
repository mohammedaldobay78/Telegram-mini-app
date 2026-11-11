import { z } from "zod";
import { adminAudit } from "@/db/schema";
import { createUserRoute, json } from "@/server/http/route";
import { saveSettingsSection } from "@/server/config/settings";

/**
 * PLAN �?10.5: kill switches are instant, audited and never require a deploy.
 * Only the `flags` section is writable from the app; economy changes go
 * through the change-control process in PLAN �?0.
 */
export const POST = createUserRoute(
  {
    route: "admin.settings",
    limit: 10,
    windowSeconds: 60,
    requireAdmin: true,
    schema: z.object({
      section: z.literal("flags"),
      value: z.object({ ads: z.boolean(), payouts: z.boolean(), store: z.boolean() }),
    }),
  },
  async ({ db, user, body, now }) => {
    const updated = await saveSettingsSection(body.section, body.value, user.telegramId, db);
    await db.insert(adminAudit).values({
      adminId: user.telegramId,
      action: "flags.update",
      payload: { flags: body.value, at: now.toISOString() },
    });
    return json({ flags: updated.flags });
  },
);
