/** A duration to the nearest minute, the way the Stay for field takes it: "1h15", "2h", or "45 min" under an hour. */
export function formatDuration(seconds: number): string {
  const total = Math.round(seconds / 60);
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h${String(minutes).padStart(2, "0")}`;
}
