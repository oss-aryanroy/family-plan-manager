/** Today as YYYY-MM-DD in the owner's time zone (OWNER_TZ, e.g. "America/New_York"; server zone if unset). */
export const today = () => new Date().toLocaleDateString("en-CA", { timeZone: process.env.OWNER_TZ || undefined });
