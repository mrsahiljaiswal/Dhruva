import type { FieldError } from "@dhruva/shared";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: FieldError[] = [],
  ) {
    super(message);
    this.name = "AppError";
  }
}
