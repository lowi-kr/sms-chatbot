// security/validate.js - Shared bounds and format checks for external input.

export const MAX_MESSAGE_LENGTH = 1600;

export function isValidPhone(value) {
  return typeof value === 'string' && /^\+[1-9]\d{7,14}$/.test(value.trim());
}

export function isValidModelId(value) {
  return typeof value === 'string' &&
    value.length <= 128 &&
    /^[A-Za-z0-9._\-/:]+$/.test(value);
}
