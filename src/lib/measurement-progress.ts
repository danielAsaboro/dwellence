export function measurementProgressText(elapsedMs: number) {
  return `Connectivity measurement running — ${Math.max(0, Math.floor(elapsedMs / 1000))} seconds elapsed.`;
}
