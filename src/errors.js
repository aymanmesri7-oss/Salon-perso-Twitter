/**
 * Traduit n'importe quelle erreur (Discord, réseau, SQLite) en phrase française claire.
 * On n'affiche jamais le message brut de l'API.
 */
const DISCORD_CODES = {
  10003: "le salon n'existe plus (il a sans doute été supprimé à la main).",
  10004: "le serveur est introuvable : GUILD_ID est faux, ou le bot n'a pas été invité sur ce serveur.",
  10007: "ce membre n'est plus sur le serveur.",
  10008: "le message n'existe plus.",
  10011: "le rôle est introuvable : ADMIN_ROLE_ID est probablement faux.",
  10013: "cet utilisateur Discord est introuvable.",
  30013: 'le serveur a atteint la limite Discord de 500 salons.',
  40001: "Discord refuse l'accès : le token du bot n'est plus valide. Régénère-le dans le portail développeur et mets à jour DISCORD_TOKEN.",
  50001:
    "le bot ne voit pas cet endroit. Vérifie que son rôle a « Voir les salons » sur la catégorie des VA.",
  50013:
    "le bot n'a pas les permissions nécessaires. Il lui faut « Gérer les salons », « Gérer les rôles », et il doit lui-même posséder toutes les permissions qu'il donne aux VA (voir le README).",
  50024: "cette action n'est pas possible sur ce type de salon.",
  50035: "Discord a refusé les informations envoyées (nom de salon invalide ou catégorie déjà pleine).",
};

export function explainError(err) {
  if (!err) return 'erreur inconnue.';

  // Catégorie pleine (Discord renvoie 50035 avec un détail)
  const raw = JSON.stringify(err.rawError ?? {});
  if (raw.includes('CHANNEL_PARENT_MAX_CHANNELS')) {
    return 'la catégorie est déjà pleine (limite Discord : 50 salons par catégorie).';
  }
  if (raw.includes('GUILD_CHANNELS_MAX') || err.code === 30013) {
    return DISCORD_CODES[30013];
  }

  if (err.name === 'RateLimitError' || err.status === 429) {
    const s = Math.ceil((err.retryAfter ?? err.timeToReset ?? 0) / 1000);
    return `Discord demande de ralentir${s ? ` (attendre ${s} s)` : ''}. L'action sera retentée plus tard.`;
  }

  if (typeof err.code === 'number' && DISCORD_CODES[err.code]) return DISCORD_CODES[err.code];

  if (err.code === 'TokenInvalid' || err.code === 'TokenMissing') {
    return 'le token du bot (DISCORD_TOKEN) est invalide ou vide. Copie-le à nouveau depuis le portail développeur Discord.';
  }
  if (err.code === 4014 || err.code === 'DisallowedIntents' || /disallowed intent/i.test(err.message ?? '')) {
    return "Discord refuse la connexion : active « Server Members Intent » dans le portail développeur (onglet Bot), puis redémarre le bot.";
  }
  if (['ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED'].includes(err.code)) {
    return 'problème de connexion internet entre Railway et Discord. Le bot réessaiera.';
  }
  if (typeof err.code === 'string' && err.code.startsWith('SQLITE_')) {
    return 'problème avec le fichier de base de données (volume Railway absent ou plein ?).';
  }
  if (err.status === 401) return DISCORD_CODES[40001];
  if (err.status === 403) return "Discord refuse l'action : le bot n'a pas l'autorisation de faire ça (permissions ou accès bloqué).";
  if (typeof err.status === 'number' && err.status >= 500) {
    return 'Discord a un problème de son côté (panne temporaire). Le bot réessaiera.';
  }
  if (err.isConfigError) return err.message;

  return `erreur inattendue${err.code ? ` (code ${err.code})` : ''}. Mets DEBUG=1 dans les variables Railway pour voir le détail technique.`;
}

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.isConfigError = true;
  }
}
