export function hasConfiguredPrice(price: unknown): boolean {
  if (typeof price !== "number" && typeof price !== "string") return false;
  if (typeof price === "string" && price.trim() === "") return false;
  const value = Number(price);
  return Number.isSafeInteger(value) && value > 0 && value < 1_000_000_000_000;
}

export function canSelectPlayer(player: { active?: boolean; price: unknown }): boolean {
  return player.active === true && hasConfiguredPrice(player.price);
}

export function comparePlayerPrices(
  first: { price: unknown }, second: { price: unknown }, ascending = false,
): number {
  const unavailable = Number(!hasConfiguredPrice(first.price)) - Number(!hasConfiguredPrice(second.price));
  if (unavailable) return unavailable;
  if (!hasConfiguredPrice(first.price)) return 0;
  const difference = Number(first.price) - Number(second.price);
  return ascending ? difference : -difference;
}
