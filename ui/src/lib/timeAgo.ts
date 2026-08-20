import { t } from "../i18n";

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;

export function timeAgo(date: Date | string): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const seconds = Math.round((now - then) / 1000);

  if (seconds < MINUTE) return t("time.justNow", { defaultValue: "just now" });
  if (seconds < HOUR) {
    const m = Math.floor(seconds / MINUTE);
    return t("time.minutesAgo", { value: m, defaultValue: "{{value}}m ago" });
  }
  if (seconds < DAY) {
    const h = Math.floor(seconds / HOUR);
    return t("time.hoursAgo", { value: h, defaultValue: "{{value}}h ago" });
  }
  if (seconds < WEEK) {
    const d = Math.floor(seconds / DAY);
    return t("time.daysAgo", { value: d, defaultValue: "{{value}}d ago" });
  }
  if (seconds < MONTH) {
    const w = Math.floor(seconds / WEEK);
    return t("time.weeksAgo", { value: w, defaultValue: "{{value}}w ago" });
  }
  const mo = Math.floor(seconds / MONTH);
  return t("time.monthsAgo", { value: mo, defaultValue: "{{value}}mo ago" });
}
