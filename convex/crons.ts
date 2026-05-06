import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

// Daily cleanup hour. Convex `cronJobs.daily` fires once per day at the given
// UTC time. 09:00 UTC ≈ 02:00 PST — quietest hour for mom's traffic. We don't
// stress about precision; this is opportunistic GC.
const crons = cronJobs();

// adminAuth sweep — drop expired/consumed magic-link tokens and expired sessions.
// Single call wipes up to 200 stale rows; in steady state we'll generate <10/day,
// so one call is always enough. If we ever fall behind (mass invalidation, a
// migration), the cron just re-fires next day and catches up.
crons.daily(
  "adminAuth: sweep expired tokens",
  { hourUTC: 9, minuteUTC: 0 },
  internal["admin/auth"].sweepExpired,
);

export default crons;
