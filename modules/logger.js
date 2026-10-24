export const logger = {
  sanitize: (data, depth = 0, seen = new WeakSet()) => {
    if (depth > 3) return '[DEPTH_LIMIT]';
    if (data === null || typeof data !== 'object') return data;
    if (seen.has(data)) return '[CIRCULAR]';

    seen.add(data);

    if (data instanceof Error) {
      return {
        name: data.name,
        message: data.message,
        stack: data.stack
      };
    }

    const sanitized = Array.isArray(data) ? [] : {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        const lowerKey = key.toLowerCase();
        if (lowerKey.includes('token') || lowerKey.includes('auth') || lowerKey.includes('password')) {
          sanitized[key] = '[REDACTED]';
          continue;
        }
        sanitized[key] = logger.sanitize(data[key], depth + 1, seen);
      }
    }
    return sanitized;
  },

  info: (msg, data = '') => {
    const cleanData = data !== '' ? logger.sanitize(data) : '';
    console.log(`[INFO] ${new Date().toISOString()}: ${msg}`, cleanData);
  },

  error: (msg, err = '') => {
    const cleanErr = err !== '' ? logger.sanitize(err) : '';
    console.error(`[ERROR] ${new Date().toISOString()}: ${msg}`, cleanErr);
  },

  debug: (msg, data = '') => {
    if (window.DEBUG_MODE) {
      const cleanData = data !== '' ? logger.sanitize(data) : '';
      console.debug(`[DEBUG] ${new Date().toISOString()}: ${msg}`, cleanData);
    }
  }
};