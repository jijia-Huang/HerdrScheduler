// Errors with a fixed code and a hint the caller (a person or an AI) can act on.
export class OpError extends Error {
  constructor(code, message, hint) {
    super(message)
    this.code = code
    this.hint = hint
  }
}

export const fail = (code, message, hint) => {
  throw new OpError(code, message, hint)
}

export function errorJson(error) {
  if (error instanceof OpError) {
    return { code: error.code, message: error.message, ...(error.hint ? { hint: error.hint } : {}) }
  }
  return { code: 'internal', message: String(error?.stack ?? error) }
}
