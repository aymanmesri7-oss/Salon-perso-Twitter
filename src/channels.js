import { ChannelType, OverwriteType, PermissionFlagsBits as P } from 'discord.js';
import { channelNameFor, ownerIdFromTopic, topicFor } from './naming.js';
import { buildWelcome, isWelcomeMessage } from './welcome.js';
import { ConfigError, explainError } from './errors.js';

export const MAX_GUILD_CHANNELS = 500;
export const MAX_PER_CATEGORY = 50;

// Ce que chaque rôle/personne peut faire dans un salon de VA.
// Le bot doit posséder lui-même chacune de ces permissions (règle Discord).
const MEMBER_ALLOW = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks, P.AddReactions];
const ADMIN_ALLOW = MEMBER_ALLOW;
const BOT_ALLOW = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.EmbedLinks, P.ManageChannels];

const MEMBER_OVERWRITE_EDIT = {
  ViewChannel: true,
  SendMessages: true,
  ReadMessageHistory: true,
  AttachFiles: true,
  EmbedLinks: true,
  AddReactions: true,
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class PrivateChannelManager {
  /**
   * @param {object} o
   * @param {import('discord.js').Guild} o.guild
   * @param {ReturnType<import('./db.js').openDatabase>} o.db
   * @param {{categoryId:string, adminRoleId:string, safetyMargin?:number, welcomeText?:string}} o.config
   * @param {import('./throttle.js').Pacer} o.pacer
   * @param {import('./throttle.js').EditGuard} o.editGuard
   * @param {{info:Function, warn:Function, error:Function}} o.log
   * @param {string} o.botId
   * @param {(memberId:string, delayMs:number)=>void} [o.scheduleRetry]
   */
  constructor({ guild, db, config, pacer, editGuard, log, botId, scheduleRetry = () => {} }) {
    Object.assign(this, { guild, db, config, pacer, editGuard, log, botId, scheduleRetry });
    this.safetyMargin = Number.isFinite(config.safetyMargin) ? config.safetyMargin : 10;
  }

  // ---------- Qui a droit à un salon ----------

  isEligible(member) {
    if (!member || member.user?.bot) return false;
    if (member.id === this.guild.ownerId) return false;
    if (member.roles?.cache?.has(this.config.adminRoleId)) return false;
    if (member.permissions?.has?.(P.Administrator)) return false;
    return true;
  }

  // ---------- Comptages ----------

  /** Salons qui comptent dans la limite des 500 (les fils de discussion ne comptent pas). */
  countGuildChannels() {
    return this.guild.channels.cache.filter((c) => !(c.isThread?.() ?? false)).size;
  }

  get channelBudget() {
    return MAX_GUILD_CHANNELS - this.safetyMargin;
  }

  childCount(categoryId) {
    return this.guild.channels.cache.filter((c) => c.parentId === categoryId).size;
  }

  // ---------- Catégories ----------

  getBaseCategory() {
    const cat = this.guild.channels.cache.get(this.config.categoryId);
    if (!cat || cat.type !== ChannelType.GuildCategory) {
      throw new ConfigError(
        "La catégorie indiquée dans CATEGORY_ID est introuvable (ou ce n'est pas une catégorie). Vérifie l'identifiant, et que le bot peut voir cette catégorie."
      );
    }
    return cat;
  }

  /** Catégorie de base + "<nom> 2", "<nom> 3"... triées. */
  getCategoryChain() {
    const base = this.getBaseCategory();
    const re = new RegExp(`^${escapeRegex(base.name)} (\\d+)$`);
    const overflow = this.guild.channels.cache
      .filter((c) => c.type === ChannelType.GuildCategory && re.test(c.name))
      .map((c) => ({ c, n: Number(re.exec(c.name)[1]) }))
      .filter((x) => x.n >= 2)
      .sort((a, b) => a.n - b.n);
    return { base, chain: [{ c: base, n: 1 }, ...overflow] };
  }

  /** Renvoie une catégorie avec de la place, ou null s'il faut en créer une. */
  findFreeCategory() {
    const { chain } = this.getCategoryChain();
    const free = chain.find(({ c }) => this.childCount(c.id) < MAX_PER_CATEGORY);
    return free ? free.c : null;
  }

  async createOverflowCategory() {
    const { base, chain } = this.getCategoryChain();
    const n = chain[chain.length - 1].n + 1;
    const name = `${base.name} ${n}`;
    const permissionOverwrites = base.permissionOverwrites.cache.map((o) => ({
      id: o.id,
      type: o.type,
      allow: o.allow.bitfield,
      deny: o.deny.bitfield,
    }));
    await this.pacer.wait();
    const cat = await this.guild.channels.create({
      name,
      type: ChannelType.GuildCategory,
      permissionOverwrites,
      reason: 'Catégorie de débordement (limite de 50 salons atteinte)',
    });
    this.log.info(`📁 Catégorie "${base.name}" pleine (50 salons) : nouvelle catégorie "${name}" créée avec les mêmes permissions.`);
    return cat;
  }

  // ---------- Retrouver le salon d'un membre ----------

  findChannelByTopic(memberId) {
    return (
      this.guild.channels.cache.find(
        (c) => c.type === ChannelType.GuildText && ownerIdFromTopic(c.topic) === memberId
      ) ?? null
    );
  }

  /** Base de données d'abord, puis sujet des salons (si la base a été perdue). */
  findExistingChannel(memberId, label = memberId) {
    const row = this.db.get(memberId);
    if (row) {
      const ch = this.guild.channels.cache.get(row.channel_id);
      if (ch) return ch;
      this.db.remove(memberId); // salon supprimé à la main
    }
    const byTopic = this.findChannelByTopic(memberId);
    if (byTopic) {
      this.db.upsert(memberId, byTopic.id, row?.created_at ?? new Date(byTopic.createdTimestamp ?? Date.now()).toISOString());
      this.log.info(`🔎 Salon de ${label} retrouvé grâce à son sujet (base de données reconstruite).`);
      return byTopic;
    }
    if (row) this.log.warn(`Le salon de ${label} a été supprimé à la main : il va être recréé.`);
    return null;
  }

  // ---------- Opérations ----------

  /**
   * Garantit que le membre a son salon, avec le bon nom, les bonnes permissions et le message de bienvenue.
   * Idempotent : peut être appelé autant de fois qu'on veut.
   * @returns {Promise<'ignored'|'exists'|'created'|'limit'|'error'>}
   */
  async ensureForMember(member) {
    if (!this.isEligible(member)) return 'ignored';
    const label = member.displayName;
    await this.ensureVaRole(member);
    try {
      const existing = this.findExistingChannel(member.id, label);
      if (existing) {
        await this.ensureMemberAccess(member, existing);
        await this.syncName(member, existing);
        await this.ensureWelcome(member, existing);
        return 'exists';
      }
      return await this.createFor(member);
    } catch (err) {
      if (err?.code === 30013) {
        this.log.error(`❌ Salon de ${label} non créé : ${explainError(err)}`);
        return 'limit';
      }
      this.log.error(`❌ Problème avec le salon de ${label} : ${explainError(err)}`);
      if (this.config.debug) this.log.error(err);
      return 'error';
    }
  }

  async createFor(member) {
    const label = member.displayName;
    let category = this.findFreeCategory();
    const needed = category ? 1 : 2; // +1 si une catégorie de débordement doit être créée
    const used = this.countGuildChannels();
    if (used + needed > this.channelBudget) {
      this.log.warn(
        `⛔ Salon de ${label} non créé : le serveur a ${used} salons sur 500 (marge de sécurité de ${this.safetyMargin} gardée).`
      );
      return 'limit';
    }
    if (!category) category = await this.createOverflowCategory();

    const name = channelNameFor(label, member.id);
    await this.pacer.wait();
    const channel = await this.guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: category.id,
      topic: topicFor(label, member.id),
      permissionOverwrites: [
        { id: this.guild.id, type: OverwriteType.Role, deny: [P.ViewChannel] },
        { id: member.id, type: OverwriteType.Member, allow: MEMBER_ALLOW },
        { id: this.config.adminRoleId, type: OverwriteType.Role, allow: ADMIN_ALLOW },
        { id: this.botId, type: OverwriteType.Member, allow: BOT_ALLOW },
      ],
      reason: `Salon privé du VA ${label}`,
    });
    this.db.upsert(member.id, channel.id);
    this.log.info(`✅ Salon créé pour ${label} (#${name}, catégorie "${category.name}").`);
    await this.ensureWelcome(member, channel);
    return 'created';
  }

  /** Donne le rôle VA (VA_ROLE_ID) s'il ne l'a pas déjà. Une erreur ici n'empêche pas la création du salon. */
  async ensureVaRole(member) {
    const roleId = this.config.vaRoleId;
    if (!roleId || member.roles.cache.has(roleId)) return 'unchanged';
    try {
      await this.pacer.wait();
      await member.roles.add(roleId, 'Rôle VA donné automatiquement');
      this.log.info(`🏷️ Rôle VA donné à ${member.displayName}.`);
      return 'added';
    } catch (err) {
      const extra =
        err?.code === 50013
          ? " Place le rôle du bot AU-DESSUS du rôle VA dans Paramètres du serveur → Rôles (glisser-déposer)."
          : '';
      this.log.error(`❌ Impossible de donner le rôle VA à ${member.displayName} : ${explainError(err)}${extra}`);
      return 'error';
    }
  }

  /** Si le membre a quitté puis rejoint le serveur, on lui redonne l'accès. */
  async ensureMemberAccess(member, channel) {
    if (channel.permissionOverwrites.cache.has(member.id)) return;
    await this.pacer.wait();
    await channel.permissionOverwrites.edit(member.id, MEMBER_OVERWRITE_EDIT, { type: OverwriteType.Member });
    this.log.info(`🔑 Accès redonné à ${member.displayName} sur son salon.`);
  }

  /** Renomme seulement si le nom (ou le sujet) a réellement changé. */
  async syncName(member, channel) {
    const label = member.displayName;
    const changes = {};
    const wantedName = channelNameFor(label, member.id, channel.name);
    const wantedTopic = topicFor(label, member.id);
    if (channel.name !== wantedName) changes.name = wantedName;
    if (channel.topic !== wantedTopic) changes.topic = wantedTopic;
    if (!Object.keys(changes).length) return 'unchanged';

    const g = this.editGuard.check(channel.id);
    if (!g.ok) {
      const min = Math.ceil(g.waitMs / 60000);
      this.log.warn(
        `⏳ Renommage du salon de ${label} reporté de ${min} min (Discord autorise 2 renommages par salon toutes les 10 minutes).`
      );
      this.scheduleRetry(member.id, g.waitMs);
      return 'deferred';
    }
    await this.pacer.wait();
    this.editGuard.record(channel.id);
    const oldName = channel.name;
    await channel.edit({ ...changes, reason: 'Le VA a changé de pseudo' });
    if (changes.name) this.log.info(`✏️ Salon renommé : #${oldName} → #${changes.name} (${label}).`);
    else this.log.info(`✏️ Sujet du salon de ${label} mis à jour.`);
    return 'renamed';
  }

  /** Envoie le message de bienvenue une seule fois, même si la base a été perdue. */
  async ensureWelcome(member, channel) {
    const row = this.db.get(member.id);
    if (row?.welcome_message_id) return 'already';

    const recent = await channel.messages.fetch({ limit: 50 });
    const found = recent.find((m) => isWelcomeMessage(m, this.botId));
    if (found) {
      this.db.setWelcome(member.id, found.id);
      return 'already';
    }
    await this.pacer.wait();
    const msg = await channel.send(buildWelcome(member, this.config.welcomeText));
    this.db.setWelcome(member.id, msg.id);
    this.log.info(`💬 Message de bienvenue envoyé à ${member.displayName}.`);
    return 'sent';
  }

  /**
   * Passage complet au démarrage. Les existants d'abord (sans rien créer), puis les créations.
   * @param {(fn:Function)=>Promise<any>} run  file d'attente (pour ne pas croiser les événements)
   */
  async syncAll(run = (fn) => fn()) {
    this.getBaseCategory(); // erreur claire tout de suite si CATEGORY_ID est faux
    const members = await this.guild.members.fetch();
    const eligible = [...members.values()].filter((m) => this.isEligible(m));
    const ignored = members.size - eligible.length;

    const withChannel = [];
    const missing = [];
    for (const m of eligible) {
      (this.findExistingChannel(m.id, m.displayName) ? withChannel : missing).push(m);
    }

    this.log.info(
      `👥 ${eligible.length} VA trouvés (${ignored} bots/admins ignorés). ${withChannel.length} salons existaient déjà, ${missing.length} à créer.`
    );

    const stats = { created: 0, exists: 0, errors: 0, notCreated: 0 };
    for (const m of withChannel) {
      const r = await run(() => this.ensureForMember(m));
      if (r === 'error') stats.errors++;
      else stats.exists++;
    }

    if (missing.length) {
      const free = this.channelBudget - this.countGuildChannels();
      this.log.info(`📊 Le serveur a ${this.countGuildChannels()} salons. Place disponible avant la limite : ${Math.max(free, 0)}.`);
    }

    for (let i = 0; i < missing.length; i++) {
      const r = await run(() => this.ensureForMember(missing[i]));
      if (r === 'created') stats.created++;
      else if (r === 'exists') stats.exists++;
      else if (r === 'limit') {
        stats.notCreated = missing.length - i;
        const names = missing.slice(i).map((m) => m.displayName);
        this.log.error(
          `⛔ LIMITE ATTEINTE : ${stats.notCreated} salon(s) n'ont pas pu être créés (limite Discord de 500 salons, marge de ${this.safetyMargin}). ` +
            `Supprime des salons inutiles puis redémarre le bot. VA concernés : ${names.join(', ')}.`
        );
        break;
      } else if (r === 'error') stats.errors++;
    }

    this.log.info(
      `🏁 Vérification terminée : ${stats.created} salon(s) créé(s), ${stats.exists} déjà en place, ${stats.notCreated} non créé(s) faute de place, ${stats.errors} erreur(s).`
    );
    return stats;
  }
}
