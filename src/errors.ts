/** One error class per error code the gengwiki services return. */

export class GengWikiError extends Error {
  readonly status: number | null;
  readonly code: string | null;

  constructor(message: string, status: number | null = null, code: string | null = null) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
  }
}

export class BadRequestError extends GengWikiError {}

/** Missing or invalid API key, or an expired login. */
export class AuthError extends GengWikiError {}

/** The key lacks a scope, or a quota is used up. */
export class ForbiddenError extends GengWikiError {}

/** The resource does not exist or is outside this key's scope. */
export class NotFoundError extends GengWikiError {}

export class ConflictError extends GengWikiError {}

/** The service cannot answer right now. Cached data is served instead when there is any. */
export class UnavailableError extends GengWikiError {}

export class RateLimitError extends UnavailableError {
  /** Seconds the server asked to wait. */
  readonly retryAfter: number;

  constructor(message: string, retryAfter = 0, status: number | null = 429, code: string | null = "rate_limited") {
    super(message, status, code);
    this.retryAfter = retryAfter;
  }
}

export class ServerError extends UnavailableError {}

export class NetworkError extends UnavailableError {}

/** A success status with the wrong content, such as a captive portal or a misrouted gateway answering in HTML. */
export class BadResponseError extends UnavailableError {}

/** The site does not expose the account routes, so keys cannot be managed from here. */
export class AccountApiUnavailable extends GengWikiError {}
