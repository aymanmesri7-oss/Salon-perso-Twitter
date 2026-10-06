// Faux serveur Discord en mémoire, pour tester sans vrai bot.
import { ChannelType, Collection, PermissionsBitField } from 'discord.js';
import { PrivateChannelManager } from '../src/channels.js';
import { openDatabase } from '../src/db.js';
import { EditGuard, Pacer } from '../src/throttle.js';

let nextId = 100000000000000000n;
export const newId = () => String(nextId++);

export const BOT_ID = '999999999999999999';
export const ADMIN_ROLE = '888888888888888888';

const bits = (v) => ({ bitfield: PermissionsBitField.resolve(v ?? 0n) });

class FakeOverwrites {
  constructor(list = []) {
    this.cache = new Collection();
    for (const o of list) this.cache.set(o.id, { id: o.id, type: o.type, allow: bits(o.allow), deny: bits(o.deny) });
  }
  async edit(id, opts, { type } = {}) {
    const allow = Object.entries(opts).filter(([, v]) => v).map(([k]) => k);
    this.cache.set(id, { id, type, allow: bits(allow), deny: bits(0n) });
    this.edits = (this.edits ?? 0) + 1;
  }
}

export class FakeChannel {
  constructor(guild, { name, type, parent, topic, permissionOverwrites }) {
    this.guild = guild;
    this.id = newId();
    this.name = name;
    this.type = type;
    this.parentId = parent ?? null;
    this.topic = topic ?? null;
    this.permissionOverwrites = new FakeOverwrites(permissionOverwrites);
    this.sent = [];
    this.editCalls = [];
    this.createdTimestamp = Date.now();
    const self = this;
    this.messages = {
      async fetch() {
        return new Collection(self.sent.map((m) => [m.id, m]));
      },
    };
  }
  isThread() {
    return false;
  }
  async edit(changes) {
    this.editCalls.push(changes);
    if (changes.name !== undefined) this.name = changes.name;
    if (changes.topic !== undefined) this.topic = changes.topic;
    return this;
  }
  async send(payload) {
    const msg = {
      id: newId(),
      author: { id: BOT_ID },
      content: payload.content,
      components: payload.components.map((row) => ({
        components: row.components.map((c) => ({ customId: c.data.custom_id })),
      })),
    };
    this.sent.push(msg);
    return msg;
  }
}

export class FakeGuild {
  constructor({ categoryName = 'VA' } = {}) {
    this.id = newId();
    this.ownerId = newId();
    this.membersMap = new Collection();
    this.channels = {
      cache: new Collection(),
      create: async (opts) => {
        const ch = new FakeChannel(this, opts);
        this.channels.cache.set(ch.id, ch);
        this.createCalls = (this.createCalls ?? 0) + 1;
        return ch;
      },
    };
    this.members = { fetch: async () => this.membersMap };
    this.category = new FakeChannel(this, {
      name: categoryName,
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        { id: this.id, type: 0, deny: ['ViewChannel'] },
        { id: ADMIN_ROLE, type: 0, allow: ['ViewChannel', 'ManageMessages'] },
      ],
    });
    this.channels.cache.set(this.category.id, this.category);
  }

  addMember(displayName, { bot = false, admin = false, adminPerm = false } = {}) {
    const id = newId();
    const roles = new Collection(admin ? [[ADMIN_ROLE, {}]] : []);
    const m = {
      id,
      displayName,
      user: { id, bot },
      roles: { cache: roles },
      permissions: { has: () => adminPerm },
    };
    this.membersMap.set(id, m);
    return m;
  }

  /** Ajoute n salons "bidon" (pour remplir une catégorie ou le serveur). */
  addFillerChannels(n, parentId = null) {
    for (let i = 0; i < n; i++) {
      const ch = new FakeChannel(this, { name: `autre-${i}`, type: ChannelType.GuildText, parent: parentId });
      this.channels.cache.set(ch.id, ch);
    }
  }

  textChannels() {
    return [...this.channels.cache.values()].filter((c) => c.type === ChannelType.GuildText);
  }
}

export function makeLogger() {
  const lines = [];
  const push = (lvl) => (m) => lines.push(`${lvl} ${typeof m === 'string' ? m : String(m)}`);
  return { lines, info: push('INFO'), warn: push('WARN'), error: push('ERROR'), text: () => lines.join('\n') };
}

export function makeManager(guild, { db = openDatabase(':memory:'), log = makeLogger(), editGuard, safetyMargin = 10 } = {}) {
  const retries = [];
  const manager = new PrivateChannelManager({
    guild,
    db,
    config: { categoryId: guild.category.id, adminRoleId: ADMIN_ROLE, safetyMargin },
    pacer: new Pacer(0),
    editGuard: editGuard ?? new EditGuard(),
    log,
    botId: BOT_ID,
    scheduleRetry: (id, ms) => retries.push({ id, ms }),
  });
  return { manager, db, log, retries };
}
