/**
 * @module middleware/validate
 * @description Lightweight request-body validation middleware factory.
 */

/**
 * Returns middleware that checks `req.body` against a schema object.
 * Schema format: `{ field: { type, required?, enum?, min?, max? } }`
 *
 * @param {Object} schema
 * @returns {import('express').RequestHandler}
 *
 * @example
 *   validate({ nickname: { type: 'string', required: true, min: 1, max: 50 } })
 */
function validate(schema) {
  return (req, res, next) => {
    const errors = [];

    for (const [field, rules] of Object.entries(schema)) {
      const value = req.body[field];

      // Required check
      if (rules.required && (value === undefined || value === null || value === '')) {
        errors.push(`${field} is required`);
        continue;
      }

      // Skip optional missing fields
      if (value === undefined || value === null) continue;

      // Type check
      if (rules.type && typeof value !== rules.type) {
        errors.push(`${field} must be a ${rules.type}`);
        continue;
      }

      // Enum check
      if (rules.enum && !rules.enum.includes(value)) {
        errors.push(`${field} must be one of: ${rules.enum.join(', ')}`);
      }

      // String length
      if (rules.type === 'string') {
        if (rules.min !== undefined && value.length < rules.min) {
          errors.push(`${field} must be at least ${rules.min} characters`);
        }
        if (rules.max !== undefined && value.length > rules.max) {
          errors.push(`${field} must be at most ${rules.max} characters`);
        }
      }

      // Number range
      if (rules.type === 'number') {
        if (rules.min !== undefined && value < rules.min) {
          errors.push(`${field} must be at least ${rules.min}`);
        }
        if (rules.max !== undefined && value > rules.max) {
          errors.push(`${field} must be at most ${rules.max}`);
        }
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ success: false, error: errors.join('; '), code: 'VALIDATION_ERROR' });
    }

    next();
  };
}

module.exports = validate;
