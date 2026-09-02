/**
 * Application error with a stable machine code and a safe, app-authored human
 * message. Client responses never include raw exception text, stack traces or
 * database details (docs/SECURITY.md §12) — messages on AppError instances are
 * written by the application, not derived from internals.
 */
export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, statusCode: number, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function authRequired(): AppError {
  return new AppError('AUTH_REQUIRED', 401, 'Authentication required.');
}

export function invalidCredentials(): AppError {
  // Deliberately identical for unknown username and wrong password.
  return new AppError('INVALID_CREDENTIALS', 401, 'Invalid username or password.');
}

export function usernameTaken(): AppError {
  return new AppError('USERNAME_TAKEN', 409, 'That username is not available.');
}

export function validationFailed(message = 'Validation failed.'): AppError {
  return new AppError('VALIDATION_FAILED', 400, message);
}

export function rateLimited(): AppError {
  return new AppError('RATE_LIMITED', 429, 'Too many requests. Try again later.');
}

export function notFound(message = 'Resource not found.'): AppError {
  return new AppError('NOT_FOUND', 404, message);
}
