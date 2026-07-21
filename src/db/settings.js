// db/settings.js - Global key/value settings store

export async function getSetting(db, key, defaultValue = null) {
  const result = await db.prepare(
    `SELECT value FROM settings WHERE key = ?`
  ).bind(key).first();
  return result ? result.value : defaultValue;
}

export async function setSetting(db, key, value) {
  await db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
  ).bind(key, value).run();
}
