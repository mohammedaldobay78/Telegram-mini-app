/** Typed application errors and the wire error contract (PLAN §6). */

export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "INVALID_INIT_DATA",
  "STALE_INIT_DATA",
  "FORBIDDEN",
  "NOT_FOUND",
  "RATE_LIMITED",
  "IDEMPOTENT_REPLAY",
  "INSUFFICIENT_FUNDS",
  "INSUFFICIENT_ENERGY",
  "DAILY_CAP_REACHED",
  "COOLDOWN",
  "CONFLICT",
  "KILL_SWITCHED",
  "CONFIG_ERROR",
  "UPSTREAM_ERROR",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    options: { status?: number; retryable?: boolean; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = options.status ?? defaultStatus(code);
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

function defaultStatus(code: ErrorCode): number {
  switch (code) {
    case "VALIDATION_ERROR":
      return 400;
    case "UNAUTHORIZED":
    case "INVALID_INIT_DATA":
    case "STALE_INIT_DATA":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
    case "IDEMPOTENT_REPLAY":
      return 409;
    case "RATE_LIMITED":
    case "COOLDOWN":
      return 429;
    case "INSUFFICIENT_FUNDS":
    case "INSUFFICIENT_ENERGY":
    case "DAILY_CAP_REACHED":
    case "KILL_SWITCHED":
      return 422;
    case "CONFIG_ERROR":
      return 503;
    case "UPSTREAM_ERROR":
      return 502;
    default:
      return 500;
  }
}

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
    requestId?: string;
    details?: Record<string, unknown>;
  };
}

export function errorBody(error: AppError, requestId?: string): ApiErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(requestId ? { requestId } : {}),
      ...(error.details ? { details: error.details } : {}),
    },
  };
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
