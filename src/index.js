import { Client, Events, GatewayIntentBits, Partials, PermissionFlagsBits as P, MessageFlags } from 'discord.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { PrivateChannelManager } from './channels.js';
import { EditGuard, Pacer, SerialQueue } from './throttle.js';
import { explainError } from './errors.js';
import { WELCOME_BUTTON_ID } from './welcome.js';
import { log } from './logger.js';

// Permissions dont le bot a besoin sur le serveur (même liste que dans le README).
const REQUIRED_PERMS = {
  'Voir les salons': P.ViewChannel,
  'Gérer les salons': P.ManageChannels,
  'Gérer les rôles': P.ManageRoles,
  'Envoyer des messages': P.SendMessages,
  'Intégrer des liens': P.EmbedLinks,
  'Joindre des fichiers': P.AttachFiles,
  "Voir les anciens messages": P.ReadMessageHistory,
  'Ajouter des réactions': P.AddReactions,
};
const PERMISSIONS_INTEGER = Object.values(REQUIRED_PERMS).reduce((a, b) => a | b, 0n);

function logErr(prefix, err) {
  log.error(`❌ ${prefix} : ${explainError(err)}`);
  if (config?.debug && err) console.error(err);
}

let config;
try {
  config = loadConfig();
} catch (err) {
  log.error(`❌ Configuration incomplète : ${err.message}`);
  process.exit(1);
}

if (config.onRailway && !config.volumeMounted) {
  log.warn(
    '⚠️ Aucun volume Railway n\'est branché : la base de données sera effacée à chaque déploiement. ' +
      'Ajoute un volume monté sur /app/data (voir README). Le bot retrouvera quand même les salons grâce à leur sujet.'
  );
}

let db;
try {
  db = openDatabase(config.dbPath);
  log.info(`🗄️ Base de données ouverte (${db.all().length} salons enregistrés).`);
} catch (err) {
  logErr(`Impossible d'ouvrir la base de données`, err);
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.GuildMember],
  rest: {
    // Ne jamais rester bloqué de longues minutes : on préfère une erreur claire et un nouvel essai.
    rejectOnRateLimit: (info) => info.method === 'PATCH' && (info.retryAfter ?? info.timeToReset ?? 0) > 15_000,
  },
});

const queue = new SerialQueue();
const pacer = new Pacer(1000);
const editGuard = new EditGuard();
const retryTimers = new Map();
let manager = null;

function scheduleRetry(memberId, delayMs) {
  if (retryTimers.has(memberId)) return;
  const t = setTimeout(() => {
    retryTimers.delete(memberId);
    queue.run(async () => {
      const member = await manager.guild.members.fetch(memberId).catch(() => null);
      if (member) await manager.ensureForMember(member);
    });
  }, delayMs + 2000);
  retryTimers.set(memberId, t);
}

function checkBotPermissions(guild) {
  const me = guild.members.me;
  const missing = Object.entries(REQUIRED_PERMS)
    .filter(([, flag]) => !me.permissions.has(flag))
    .map(([name]) => name);
  if (missing.length) {
    log.error(`❌ Il manque ces permissions au rôle du bot : ${missing.join(', ')}. Ajoute-les dans Paramètres du serveur → Rôles.`);
  }
  const cat = guild.channels.cache.get(config.categoryId);
  if (cat) {
    const inCat = cat.permissionsFor(me);
    if (!inCat?.has(P.ViewChannel) || !inCat?.has(P.ManageChannels)) {
      log.error(
        `❌ Le bot ne peut pas voir ou gérer la catégorie "${cat.name}". Dans les permissions de cette catégorie, autorise son rôle à « Voir les salons » et « Gérer les salons ».`
      );
    }
  }
  if (config.vaRoleId) {
    const vaRole = guild.roles.cache.get(config.vaRoleId);
    if (!vaRole) {
      log.error('❌ Le rôle indiqué dans VA_ROLE_ID n\'existe pas sur ce serveur. Vérifie l\'identifiant.');
    } else if (vaRole.position >= me.roles.highest.position) {
      log.error(
        `❌ Le rôle du bot est placé SOUS le rôle "${vaRole.name}" : il ne pourra pas le donner. Dans Paramètres du serveur → Rôles, fais glisser le rôle du bot au-dessus de "${vaRole.name}".`
      );
    }
  }
  if (!guild.roles.cache.has(config.adminRoleId)) {
    log.error('❌ Le rôle indiqué dans ADMIN_ROLE_ID n\'existe pas sur ce serveur. Vérifie l\'identifiant.');
  }
}

client.once(Events.ClientReady, async (c) => {
  log.info(`🤖 Connecté en tant que ${c.user.tag}.`);
  if (c.user.id !== config.clientId) {
    log.warn('⚠️ CLIENT_ID ne correspond pas au bot connecté. Vérifie la variable CLIENT_ID.');
  }
  log.info(
    `🔗 Lien d'invitation (si besoin) : https://discord.com/oauth2/authorize?client_id=${c.user.id}&permissions=${PERMISSIONS_INTEGER}&scope=bot`
  );

  let guild;
  try {
    guild = await c.guilds.fetch(config.guildId);
    await guild.channels.fetch();
    await guild.roles.fetch();
  } catch (err) {
    logErr(`Impossible d'accéder au serveur`, err);
    return;
  }
  log.info(`🏠 Serveur : ${guild.name}.`);
  checkBotPermissions(guild);

  manager = new PrivateChannelManager({
    guild,
    db,
    config,
    pacer,
    editGuard,
    log,
    botId: c.user.id,
    scheduleRetry,
  });

  try {
    await manager.syncAll((fn) => queue.run(fn));
  } catch (err) {
    logErr(`La vérification de démarrage a échoué`, err);
  }
});

client.on(Events.GuildMemberAdd, (member) => {
  if (!manager || member.guild.id !== config.guildId) return;
  log.info(`👋 ${member.displayName} vient de rejoindre le serveur.`);
  queue.run(() => manager.ensureForMember(member));
});

client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
  if (!manager || newMember.guild.id !== config.guildId) return;
  if (oldMember.partial || oldMember.displayName !== newMember.displayName) {
    queue.run(() => manager.ensureForMember(newMember));
  }
});

// Changement du nom d'affichage global (pas seulement du surnom sur le serveur)
client.on(Events.UserUpdate, async (oldUser, newUser) => {
  if (!manager) return;
  if (oldUser.globalName === newUser.globalName && oldUser.username === newUser.username) return;
  const member = manager.guild.members.cache.get(newUser.id);
  if (member) queue.run(() => manager.ensureForMember(member));
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton() || interaction.customId !== WELCOME_BUTTON_ID) return;
  try {
    await interaction.reply({ content: 'Merci, c\'est bien noté ! 👍', flags: MessageFlags.Ephemeral });
    log.info(`👍 ${interaction.member?.displayName ?? interaction.user.username} a confirmé avoir lu le message de bienvenue.`);
  } catch (err) {
    logErr(`Impossible de répondre au clic sur le bouton`, err);
  }
});

client.on(Events.Error, (err) => logErr(`Erreur de connexion Discord`, err));
client.on(Events.ShardDisconnect, (ev) => {
  if (ev?.code === 4014) log.error(`❌ ${explainError({ code: 4014 })}`);
});
process.on('unhandledRejection', (err) => logErr(`Erreur non prévue`, err));

function shutdown() {
  log.info('👋 Arrêt du bot.');
  for (const t of retryTimers.values()) clearTimeout(t);
  try {
    db.close();
  } catch {}
  client.destroy().finally(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

client.login(config.token).catch((err) => {
  logErr(`Connexion à Discord impossible`, err);
  process.exit(1);
});
