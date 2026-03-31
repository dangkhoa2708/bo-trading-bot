export function effectivePancakeBetWei(
  baseBetWei: bigint,
  direction: "UP" | "DOWN",
): bigint {
  if (direction === "UP") return baseBetWei / 2n;
  return baseBetWei;
}
