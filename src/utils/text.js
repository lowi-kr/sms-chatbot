// utils/text.js - Small text helpers shared across the reply path.

// Hard SMS limit enforced on every outbound reply (also stated in the system
// prompt, see security/filter.js).
export const SMS_MAX_LENGTH = 950;

// Truncates to `max` characters, reserving room for a trailing ellipsis.
export function truncate(text, max) {
  return text.length > max ? `${text.substring(0, max - 3)}...` : text;
}

export function truncateForSms(text) {
  return truncate(text, SMS_MAX_LENGTH);
}
