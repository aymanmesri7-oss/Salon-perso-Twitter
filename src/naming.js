// Lettres qui ne se décomposent pas toutes seules en ASCII.
const SPECIAL = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i' };

/**
 * "Jean Dupont" -> "jean-dupont", "Élodie 🔥" -> "elodie", "😀😀" -> "".
 * NFKD transforme aussi les lettres "stylisées" (𝓙𝓮𝓪𝓷 -> Jean).
 */
export function slugify(input) {
  if (!input) return '';
  return String(input)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // accents
    .toLowerCase()
    .replace(/[ßæœøłđðþı]/g, (c) => SPECIAL[c])
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
    .replace(/-+$/g, '');
}

/** Nom voulu pour le salon. Jamais vide. */
export function channelNameFor(displayName, memberId, currentName = null) {
  const slug = slugify(displayName);
  if (slug) return slug;
  if (currentName) return currentName; // pseudo 100 % emojis : on garde le nom actuel
  return `va-${memberId}`;
}

export function topicFor(displayName, memberId) {
  return `Salon privé de ${displayName} (${memberId})`;
}

const TOPIC_ID = /\((\d{17,20})\)\s*$/;

/** Retrouve l'identifiant du propriétaire écrit dans le sujet du salon. */
export function ownerIdFromTopic(topic) {
  if (!topic) return null;
  const m = TOPIC_ID.exec(topic);
  return m ? m[1] : null;
}
