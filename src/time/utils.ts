export function fmtGmt7(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

/** Same as {@link fmtGmt7} with explicit zone suffix for signal copy. */
export function fmtGmt7WithZoneLabel(ms: number): string {
  return `${fmtGmt7(ms)} GMT+7`;
}

export function gmt7DateKey(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}
