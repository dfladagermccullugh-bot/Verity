/**
 * Calling hours. A call may be placed only when the local time is inside the permitted window
 * in EVERY time zone the respondent could be in. Mobile numbers keep their area code when people
 * move, so the area code is not treated as a location: the zones come from what the contact file
 * says (a time zone, or a US state), and when it says nothing, from all US zones at once.
 */

export interface CallWindow {
  /** First permitted hour, local time, 0–23. */
  startHour: number;
  /** Calls must start before this hour, local time, 1–24. */
  endHour: number;
  /** Permitted days, 0 = Sunday. */
  days: number[];
}

/** Narrower than the 8am–9pm norm for telephone solicitation, on purpose. */
export const DEFAULT_WINDOW: CallWindow = { startHour: 9, endHour: 20, days: [0, 1, 2, 3, 4, 5, 6] };

const ET = "America/New_York";
const CT = "America/Chicago";
const MT = "America/Denver";
const PT = "America/Los_Angeles";
const AZ = "America/Phoenix";
const AK = "America/Anchorage";
const HI = "Pacific/Honolulu";

/** Every zone in the 50 states and DC. Used when nothing is known about where the respondent is. */
export const ALL_US_ZONES = [ET, CT, MT, AZ, PT, AK, HI];

/** Zones in use in each state. States that straddle zones list all of them. */
export const STATE_ZONES: Record<string, string[]> = {
  AL: [CT], AK: [AK, HI], AZ: [AZ, MT], AR: [CT], CA: [PT], CO: [MT], CT: [ET], DE: [ET], DC: [ET], FL: [ET, CT], GA: [ET],
  HI: [HI], ID: [MT, PT], IL: [CT], IN: [ET, CT], IA: [CT], KS: [CT, MT], KY: [ET, CT], LA: [CT], ME: [ET], MD: [ET],
  MA: [ET], MI: [ET, CT], MN: [CT], MS: [CT], MO: [CT], MT: [MT], NE: [CT, MT], NV: [PT, MT], NH: [ET], NJ: [ET],
  NM: [MT], NY: [ET], NC: [ET], ND: [CT, MT], OH: [ET], OK: [CT], OR: [PT, MT], PA: [ET], RI: [ET], SC: [ET],
  SD: [CT, MT], TN: [ET, CT], TX: [CT, MT], UT: [MT], VT: [ET], VA: [ET], WA: [PT], WV: [ET], WI: [CT], WY: [MT],
};

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The zones a respondent could be in, from what the contact file says. Unknown values are ignored. */
export function zonesFor(contact: { timezone?: string | null; stateCode?: string | null }): string[] {
  const zones = new Set<string>();
  if (contact.timezone && isValidTimeZone(contact.timezone)) zones.add(contact.timezone);
  const state = contact.stateCode?.trim().toUpperCase();
  if (state && STATE_ZONES[state]) for (const z of STATE_ZONES[state]) zones.add(z);
  return zones.size > 0 ? [...zones] : ALL_US_ZONES;
}

export function localTime(at: Date, timeZone: string): { hour: number; minute: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { hour: Number(get("hour")), minute: Number(get("minute")), day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")) };
}

export function withinWindow(at: Date, zones: string[], window: CallWindow = DEFAULT_WINDOW): boolean {
  if (zones.length === 0) return false;
  return zones.every((z) => {
    const t = localTime(at, z);
    return window.days.includes(t.day) && t.hour >= window.startHour && t.hour < window.endHour;
  });
}

/** The next moment at or after `from` when a call is permitted, checked in 5-minute steps for up to 8 days. */
export function nextPermitted(from: Date, zones: string[], window: CallWindow = DEFAULT_WINDOW): Date | null {
  const step = 5 * 60_000;
  let t = Math.ceil(from.getTime() / step) * step;
  if (withinWindow(from, zones, window)) return from;
  for (let i = 0; i < (8 * 24 * 60) / 5; i++, t += step) {
    const d = new Date(t);
    if (withinWindow(d, zones, window)) return d;
  }
  return null;
}
