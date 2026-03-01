export class HttpError extends Error {
  /**
   * @param {number} statusCode
   * @param {string} message
   */
  constructor(statusCode, message) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

export function badRequest(message = 'Bad request') {
  return new HttpError(400, message);
}

export function unauthorized(message = 'Unauthorized') {
  return new HttpError(401, message);
}

export function forbidden(message = 'Forbidden') {
  return new HttpError(403, message);
}

export function notFound(message = 'Not found') {
  return new HttpError(404, message);
}

export function conflict(message = 'Conflict') {
  return new HttpError(409, message);
}

export function tooManyRequests(message = 'Too many requests') {
  return new HttpError(429, message);
}
