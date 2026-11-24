export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const notFound = () =>
  new AppError(404, "DINNER_NOT_FOUND", "Dinner not found for this host.");
export function requireUuid(value, name = "ID") {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new AppError(400, "INVALID_ID", `${name} must be a valid UUID.`);
  }
  return value.toLowerCase();
}
