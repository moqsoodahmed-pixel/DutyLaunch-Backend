import mongoose from 'mongoose';
import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export function notFoundHandler(req, res, next) {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} does not exist`));
}

/* eslint-disable no-unused-vars */
export function errorHandler(err, req, res, next) {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Something went wrong on our side';
  let errors = err.errors || [];

  if (err instanceof mongoose.Error.ValidationError) {
    statusCode = 400;
    message = 'Some fields need attention';
    errors = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
  }

  if (err instanceof mongoose.Error.CastError) {
    statusCode = 400;
    message = `That ${err.path} is not valid`;
  }

  if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyValue || { value: '' })[0];
    message = `An entry with that ${field} already exists`;
    errors = [{ field, message: 'Already in use' }];
  }

  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Your session is not valid. Sign in again.';
  }
  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Your session expired. Sign in again.';
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    statusCode = 413;
    message = 'That file is larger than the allowed limit';
  }

  if (statusCode >= 500) {
    logger.error(`${req.method} ${req.originalUrl} → ${err.stack || err.message}`);
    if (env.isProd) message = 'Something went wrong on our side';
  }

  res.status(statusCode).json({
    success: false,
    message,
    errors,
    ...(env.isProd ? {} : { stack: err.stack }),
  });
}
