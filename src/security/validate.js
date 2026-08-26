// security/validate.js - Shared bounds and format checks for external input.

export const MAX_MESSAGE_LENGTH = 1600;

export function normalizePhone(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function isValidPhone(value) {
  return /^\+[1-9]\d{7,14}$/.test(normalizePhone(value));
}

export function decodePhoneParam(rawSegment) {
  let decoded;
  try {
    decoded = decodeURIComponent(rawSegment);
  } catch {
    return null;
  }

  const phone = normalizePhone(decoded);
  return isValidPhone(phone) ? phone : null;
}

export function isValidModelId(value) {
  return typeof value === 'string' &&
    value.length <= 128 &&
    /^[A-Za-z0-9._\-/:]+$/.test(value);
}
