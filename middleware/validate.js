import { ApiError } from '../utils/ApiError.js';

/**
 * Runs a Zod schema against a request segment and replaces it with the
 * parsed (and therefore stripped) value, so unknown keys never reach Mongo.
 */
export const validate =
  (schema, source = 'body') =>
  (req, res, next) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || source,
        message: issue.message,
      }));
      return next(ApiError.badRequest('Some fields need attention', errors));
    }

    if (source === 'body') req.body = result.data;
    else req.validatedQuery = result.data;
    return next();
  };
