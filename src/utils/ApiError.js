class ApiError extends Error {
  constructor(statusCode, message, isOperational = true, stack = '', meta = null) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.stack = stack || Error.captureStackTrace(this, this.constructor);
    if (meta && typeof meta === 'object') this.meta = meta;
  }
}

export default ApiError;
