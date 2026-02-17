export class ControlledError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, any> | undefined} details
   */
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ControlledError';
    this.code = code;
    if (details && typeof details === 'object') {
      this.details = details;
    }
  }
}

/**
 * @param {unknown} err
 */
export function asIpcError(err) {
  if (err instanceof ControlledError) {
    return { code: err.code, message: err.message, details: err.details };
  }

  if (err instanceof Error) {
    return { code: 'INTERNAL_ERROR', message: err.message };
  }

  return { code: 'UNKNOWN_ERROR', message: 'Unexpected error' };
}
