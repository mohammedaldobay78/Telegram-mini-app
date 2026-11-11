import type { PayoutsSettings } from "@/server/config/settings";
import type { GiftTier } from "@/server/economy/pricing";
import { giftCostUsdMicro, giftPrice } from "@/server/economy/pricing";

export interface RedemptionEligibilityInput {
  settings: PayoutsSettings;
  tier: GiftTier;
  accountAgeDays: number;
  lifetimeTaps: number;
  lifetimeAdViews: number;
  estRevenueMicro: number;
  hasOpenRedemption: boolean;
  weeklyStars: number;
  monthlyStars: number;
  riskFlags: Record<string, unknown>;
  balance: number;
}

export interface EligibilityIssue {
  code: string;
  message: string;
}

export interface EligibilityResult {
  ok: boolean;
  issues: EligibilityIssue[];
  coins: number;
  stars: number;
  requiredRevenueMicro: number;
  weeklyRemaining: number;
  monthlyRemaining: number;
}

/** PLAN §9.2 + §9.5, pure so it can be unit-tested and re-used by the admin UI. */
export function checkRedemptionEligibility(input: RedemptionEligibilityInput): EligibilityResult {
  const { coins, stars } = giftPrice(input.settings, input.tier);
  const requiredRevenueMicro = Math.floor(giftCostUsdMicro(input.settings, stars) * input.settings.revenue_multiplier);
  const issues: EligibilityIssue[] = [];

  if (input.balance < coins) {
    issues.push({ code: "INSUFFICIENT_FUNDS", message: `You need ${coins} coins for this gift` });
  }
  if (input.accountAgeDays < input.settings.min_account_age_days) {
    issues.push({ code: "ACCOUNT_TOO_NEW", message: `Account must be at least ${input.settings.min_account_age_days} days old` });
  }
  if (input.lifetimeTaps < input.settings.min_taps) {
    issues.push({ code: "TAPS_TOO_LOW", message: `You need at least ${input.settings.min_taps} taps` });
  }
  if (input.lifetimeAdViews < input.settings.min_ad_views) {
    issues.push({ code: "ADS_TOO_LOW", message: `You need at least ${input.settings.min_ad_views} ad views` });
  }
  if (input.hasOpenRedemption) {
    issues.push({ code: "OPEN_REDEMPTION", message: "You already have a redemption in progress" });
  }
  if (input.estRevenueMicro < requiredRevenueMicro) {
    issues.push({
      code: "REVENUE_GATE",
      message: "Ad revenue gate not reached for this gift yet",
    });
  }
  if (Object.keys(input.riskFlags).length > 0) {
    issues.push({ code: "RISK_FLAGS", message: "Account is under review" });
  }

  const weeklyRemaining = Math.max(0, input.settings.weekly_cap_stars - input.weeklyStars);
  const monthlyRemaining = Math.max(0, input.settings.monthly_cap_stars - input.monthlyStars);
  if (stars > weeklyRemaining) {
    issues.push({ code: "WEEKLY_CAP", message: "Weekly Star cap reached" });
  }
  if (stars > monthlyRemaining) {
    issues.push({ code: "MONTHLY_CAP", message: "Monthly Star cap reached" });
  }

  return {
    ok: issues.length === 0,
    issues,
    coins,
    stars,
    requiredRevenueMicro,
    weeklyRemaining,
    monthlyRemaining,
  };
}

export function revenueGateRatio(estRevenueMicro: number, stars: number, settings: PayoutsSettings): number {
  const cost = giftCostUsdMicro(settings, stars);
  return cost > 0 ? estRevenueMicro / cost : Number.POSITIVE_INFINITY;
}

export function globalBudgetAllows(input: {
  settings: PayoutsSettings;
  trailing30dAdRevenueMicro: number;
  starsSpentLast30d: number;
  nextStars: number;
}): boolean {
  const budgetStars = (input.trailing30dAdRevenueMicro * input.settings.global_budget_ratio) / input.settings.star_value_micro;
  return input.starsSpentLast30d + input.nextStars <= budgetStars;
}
