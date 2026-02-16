export class ControlledError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'ControlledError';
    this.code = code;
  }
}

/**
 * @param {unknown} err
 */
export function asIpcError(err) {
  if (err instanceof ControlledError) {
    return { code: err.code, message: err.message };
  }

  if (err instanceof Error) {
    return { code: 'INTERNAL_ERROR', message: err.message };
  }

  return { code: 'UNKNOWN_ERROR', message: 'Unexpected error' };
}
