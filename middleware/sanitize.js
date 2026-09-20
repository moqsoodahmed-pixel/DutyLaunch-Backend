/**
 * Strips Mongo operator keys ($gt, $where) and dotted paths from user input.
 * Express 5 makes req.query a getter, so each segment is cleaned in place.
 */
function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (key.startsWith('$') || key.includes('.')) delete value[key];
      else value[key] = clean(value[key]);
    }
  }
  return value;
}

export function mongoSanitize(req, res, next) {
  if (req.body) clean(req.body);
  if (req.params) clean(req.params);
  if (req.query) clean(req.query);
  next();
}
