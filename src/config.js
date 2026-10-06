import path from 'node:path';

const REQUIRED = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID', 'CATEGORY_ID', 'ADMIN_ROLE_ID'];
const SNOWFLAKE = /^\d{17,20}$/;

export function loadConfig(env = process.env) {
  const missing = REQUIRED.filter((k) => !env[k] || !String(env[k]).trim());
  if (missing.length) {
    throw new Error(
      `Il manque ces variables dans Railway (onglet "Variables" du service) : ${missing.join(', ')}.`
    );
  }

  for (const k of ['CLIENT_ID', 'GUILD_ID', 'CATEGORY_ID', 'ADMIN_ROLE_ID', 'VA_ROLE_ID']) {
    if (k === 'VA_ROLE_ID' && !env[k]) continue; // facultatif
    if (!SNOWFLAKE.test(String(env[k]).trim())) {
      throw new Error(
        `La variable ${k} ne ressemble pas à un identifiant Discord (il faut 17 à 20 chiffres, sans espace). Valeur actuelle : "${env[k]}".`
      );
    }
  }

  const onRailway = Boolean(env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID);
  const defaultDir = onRailway ? '/app/data' : path.resolve('data');

  return {
    token: env.DISCORD_TOKEN.trim(),
    clientId: env.CLIENT_ID.trim(),
    guildId: env.GUILD_ID.trim(),
    categoryId: env.CATEGORY_ID.trim(),
    adminRoleId: env.ADMIN_ROLE_ID.trim(),
    vaRoleId: env.VA_ROLE_ID ? env.VA_ROLE_ID.trim() : null,
    dbPath: env.DB_PATH || path.join(defaultDir, 'salons.db'),
    onRailway,
    volumeMounted: Boolean(env.RAILWAY_VOLUME_MOUNT_PATH),
    safetyMargin: Number.parseInt(env.SAFETY_MARGIN ?? '10', 10),
    welcomeText: env.WELCOME_TEXT || null,
    debug: env.DEBUG === '1',
  };
}
