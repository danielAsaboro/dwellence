export function requireConsents(
  consents: Record<string, boolean>,
  required: string[],
) {
  const missing = required.filter((name) => consents[name] !== true);
  if (missing.length > 0)
    throw new Error(
      `Review and accept the ${missing.join(" and ")} consent${missing.length === 1 ? "" : "s"} before continuing.`,
    );
}
