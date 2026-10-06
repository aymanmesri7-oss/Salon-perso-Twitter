import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Base SQLite : un salon par membre.
 * Colonnes demandées : member_id (clé primaire), channel_id, created_at.
 * Colonne en plus : welcome_message_id, pour ne jamais renvoyer le message de bienvenue.
 */
export function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS salons_va (
      member_id          TEXT PRIMARY KEY,
      channel_id         TEXT NOT NULL,
      created_at         TEXT NOT NULL,
      welcome_message_id TEXT
    )
  `);

  const qGet = db.prepare('SELECT * FROM salons_va WHERE member_id = ?');
  const qUpsert = db.prepare(`
    INSERT INTO salons_va (member_id, channel_id, created_at)
    VALUES (@memberId, @channelId, @createdAt)
    ON CONFLICT(member_id) DO UPDATE SET channel_id = excluded.channel_id
  `);
  const qResetWelcome = db.prepare(
    'UPDATE salons_va SET welcome_message_id = NULL WHERE member_id = ? AND channel_id <> ?'
  );
  const qWelcome = db.prepare('UPDATE salons_va SET welcome_message_id = ? WHERE member_id = ?');
  const qRemove = db.prepare('DELETE FROM salons_va WHERE member_id = ?');
  const qAll = db.prepare('SELECT * FROM salons_va');

  return {
    get: (memberId) => qGet.get(memberId) ?? null,
    upsert(memberId, channelId, createdAt = new Date().toISOString()) {
      qResetWelcome.run(memberId, channelId); // salon différent => bienvenue à refaire
      qUpsert.run({ memberId, channelId, createdAt });
    },
    setWelcome: (memberId, messageId) => qWelcome.run(messageId, memberId),
    remove: (memberId) => qRemove.run(memberId),
    all: () => qAll.all(),
    close: () => db.close(),
  };
}
