import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType } from 'discord.js';
import { slugify, channelNameFor, ownerIdFromTopic, topicFor } from '../src/naming.js';
import { explainError } from '../src/errors.js';
import { EditGuard } from '../src/throttle.js';
import { openDatabase } from '../src/db.js';
import { FakeGuild, makeManager, VA_ROLE } from './fakes.js';

// ---------- Noms de salon ----------

test('pseudo -> nom de salon', () => {
  assert.equal(slugify('Jean Dupont'), 'jean-dupont');
  assert.equal(slugify('Élodie Çà  Va'), 'elodie-ca-va');
  assert.equal(slugify('  Jean 🔥 Dupont  '), 'jean-dupont');
  assert.equal(slugify('Œuvre Straße'), 'oeuvre-strasse');
  assert.equal(slugify('𝓙𝓮𝓪𝓷'), 'jean');
  assert.equal(slugify('😀🔥✨'), '');
});

test('pseudo en emojis uniquement : jamais de nom vide', () => {
  assert.equal(channelNameFor('😀🔥', '123456789012345678'), 'va-123456789012345678');
  assert.equal(channelNameFor('😀🔥', '123456789012345678', 'ancien-nom'), 'ancien-nom');
});

test("l'identifiant est relu depuis le sujet", () => {
  const t = topicFor('Jean (le boss)', '123456789012345678');
  assert.equal(t, 'Salon privé de Jean (le boss) (123456789012345678)');
  assert.equal(ownerIdFromTopic(t), '123456789012345678');
  assert.equal(ownerIdFromTopic('autre chose'), null);
});

// ---------- Création ----------

test('un salon par VA, permissions privées, sujet et bienvenue', async () => {
  const g = new FakeGuild();
  const jean = g.addMember('Jean Dupont');
  const { manager, db, log } = makeManager(g);

  await manager.syncAll();

  const [ch] = g.textChannels();
  assert.equal(ch.name, 'jean-dupont');
  assert.equal(ch.parentId, g.category.id);
  assert.equal(ch.topic, `Salon privé de Jean Dupont (${jean.id})`);
  assert.ok(ch.permissionOverwrites.cache.has(jean.id));
  assert.ok(ch.permissionOverwrites.cache.has(g.id)); // @everyone refusé
  assert.equal(ch.sent.length, 1);
  assert.equal(db.get(jean.id).channel_id, ch.id);
  assert.match(log.text(), /Salon créé pour Jean Dupont/);
});

test('bots et administrateurs exclus', async () => {
  const g = new FakeGuild();
  g.addMember('Un Bot', { bot: true });
  g.addMember('Admin Role', { admin: true });
  g.addMember('Admin Perm', { adminPerm: true });
  const { manager } = makeManager(g);
  await manager.syncAll();
  assert.equal(g.textChannels().length, 0);
});

// ---------- Idempotence ----------

test('relancer 10 fois : aucun doublon, aucun message en double', async () => {
  const g = new FakeGuild();
  for (const n of ['Jean', 'Marie', 'Paul']) g.addMember(n);
  const db = openDatabase(':memory:');
  for (let i = 0; i < 10; i++) {
    const { manager } = makeManager(g, { db });
    await manager.syncAll();
  }
  const chans = g.textChannels();
  assert.equal(chans.length, 3);
  for (const c of chans) assert.equal(c.sent.length, 1);
});

test('base de données perdue : salons retrouvés par le sujet, aucun doublon', async () => {
  const g = new FakeGuild();
  for (const n of ['Jean', 'Marie']) g.addMember(n);
  await makeManager(g).manager.syncAll();

  const fresh = makeManager(g); // nouvelle base vide
  const stats = await fresh.manager.syncAll();

  assert.equal(stats.created, 0);
  assert.equal(g.textChannels().length, 2);
  for (const c of g.textChannels()) assert.equal(c.sent.length, 1);
  assert.equal(fresh.db.all().length, 2);
  assert.match(fresh.log.text(), /retrouvé grâce à son sujet/);
});

test('arrivée pendant le démarrage : appels simultanés sans doublon', async () => {
  const g = new FakeGuild();
  const m = g.addMember('Jean');
  const { manager } = makeManager(g);
  const { SerialQueue } = await import('../src/throttle.js');
  const q = new SerialQueue();
  await Promise.all([q.run(() => manager.ensureForMember(m)), q.run(() => manager.ensureForMember(m)), manager.syncAll((fn) => q.run(fn))]);
  assert.equal(g.textChannels().length, 1);
  assert.equal(g.textChannels()[0].sent.length, 1);
});

test('salon supprimé à la main : recréé une seule fois', async () => {
  const g = new FakeGuild();
  g.addMember('Jean');
  const { manager, db } = makeManager(g);
  await manager.syncAll();
  const [old] = g.textChannels();
  g.channels.cache.delete(old.id);
  await manager.syncAll();
  await manager.syncAll();
  assert.equal(g.textChannels().length, 1);
  assert.notEqual(g.textChannels()[0].id, old.id);
  assert.equal(g.textChannels()[0].sent.length, 1);
  assert.equal(db.all().length, 1);
});

// ---------- Débordement de catégorie ----------

test('catégorie pleine à 50 : création de "VA 2" avec les mêmes permissions', async () => {
  const g = new FakeGuild({ categoryName: 'VA' });
  g.addFillerChannels(50, g.category.id);
  g.addMember('Jean');
  const { manager, log } = makeManager(g);

  await manager.syncAll();

  const cat2 = [...g.channels.cache.values()].find((c) => c.type === ChannelType.GuildCategory && c.name === 'VA 2');
  assert.ok(cat2, 'la catégorie VA 2 doit exister');
  const jean = g.textChannels().find((c) => c.name === 'jean');
  assert.equal(jean.parentId, cat2.id);

  const perms = (cat) =>
    [...cat.permissionOverwrites.cache.values()].map((o) => `${o.id}:${o.allow.bitfield}:${o.deny.bitfield}`).sort();
  assert.deepEqual(perms(cat2), perms(g.category));
  assert.match(log.text(), /nouvelle catégorie "VA 2"/);
});

test('49 salons : on remplit la catégorie de base, puis on déborde', async () => {
  const g = new FakeGuild({ categoryName: 'VA' });
  g.addFillerChannels(49, g.category.id);
  g.addMember('Jean');
  g.addMember('Marie');
  const { manager } = makeManager(g);
  await manager.syncAll();
  const byName = Object.fromEntries(g.textChannels().map((c) => [c.name, c]));
  assert.equal(byName.jean.parentId, g.category.id);
  const cat2 = [...g.channels.cache.values()].find((c) => c.name === 'VA 2');
  assert.equal(byName.marie.parentId, cat2.id);
});

test('"VA" et "VA 2" pleines : création de "VA 3"', async () => {
  const g = new FakeGuild({ categoryName: 'VA' });
  g.addFillerChannels(50, g.category.id);
  const cat2 = await g.channels.create({ name: 'VA 2', type: ChannelType.GuildCategory });
  g.addFillerChannels(50, cat2.id);
  g.addMember('Jean');
  const { manager } = makeManager(g);
  await manager.syncAll();
  const cat3 = [...g.channels.cache.values()].find((c) => c.name === 'VA 3');
  assert.ok(cat3);
  assert.equal(g.textChannels().find((c) => c.name === 'jean').parentId, cat3.id);
});

// ---------- Limite des 500 salons ----------

test('limite du serveur : arrêt avec la marge, et compte des salons non créés', async () => {
  const g = new FakeGuild();
  g.addFillerChannels(486); // + 1 catégorie = 487 ; budget = 490 -> 3 places
  for (let i = 0; i < 5; i++) g.addMember(`VA ${i}`);
  const { manager, log } = makeManager(g, { safetyMargin: 10 });

  const stats = await manager.syncAll();

  assert.equal(stats.created, 3);
  assert.equal(stats.notCreated, 2);
  assert.ok(manager.countGuildChannels() <= 490);
  assert.match(log.text(), /2 salon\(s\) n'ont pas pu être créés/);
});

// ---------- Renommage ----------

test('renommage seulement si le nom a changé', async () => {
  const g = new FakeGuild();
  const m = g.addMember('Jean');
  const { manager } = makeManager(g);
  await manager.syncAll();
  const [ch] = g.textChannels();

  await manager.ensureForMember(m);
  assert.equal(ch.editCalls.length, 0);

  m.displayName = 'Jean Paul';
  await manager.ensureForMember(m);
  assert.equal(ch.name, 'jean-paul');
  assert.equal(ch.editCalls.length, 1);
});

test('pseudo changé en emojis : le salon garde son nom', async () => {
  const g = new FakeGuild();
  const m = g.addMember('Jean');
  const { manager } = makeManager(g);
  await manager.syncAll();
  const [ch] = g.textChannels();

  m.displayName = '🔥🔥🔥';
  await manager.ensureForMember(m);
  assert.equal(ch.name, 'jean');
  assert.equal(ch.topic, `Salon privé de 🔥🔥🔥 (${m.id})`); // l'identifiant reste dans le sujet
});

test('nouveau VA avec pseudo en emojis : salon va-<identifiant>', async () => {
  const g = new FakeGuild();
  const m = g.addMember('😀✨');
  const { manager } = makeManager(g);
  await manager.syncAll();
  assert.equal(g.textChannels()[0].name, `va-${m.id}`);
});

test('3e renommage en 10 minutes : reporté, pas envoyé à Discord', async () => {
  let now = 0;
  const g = new FakeGuild();
  const m = g.addMember('A');
  const { manager, retries } = makeManager(g, { editGuard: new EditGuard({ now: () => now }) });
  await manager.syncAll();
  const [ch] = g.textChannels();

  for (const name of ['B', 'C', 'D']) {
    m.displayName = name;
    now += 1000;
    await manager.ensureForMember(m);
  }
  assert.equal(ch.editCalls.length, 2);
  assert.equal(ch.name, 'c');
  assert.equal(retries.length, 1);

  now += 10 * 60 * 1000; // 10 minutes plus tard
  await manager.ensureForMember(m);
  assert.equal(ch.name, 'd');
});

// ---------- Erreurs ----------

test('les erreurs Discord sont expliquées en français, sans message brut', () => {
  const raw = { code: 50013, message: 'Missing Permissions', status: 403 };
  const txt = explainError(raw);
  assert.match(txt, /permissions/);
  assert.doesNotMatch(txt, /Missing Permissions/);
  assert.match(explainError({ code: 50035, rawError: { errors: { parent_id: { _errors: [{ code: 'CHANNEL_PARENT_MAX_CHANNELS' }] } } } }), /50 salons/);
  assert.match(explainError({ code: 30013 }), /500 salons/);
  assert.match(explainError({ code: 'TokenInvalid' }), /token/);
  assert.match(explainError({ code: 4014 }), /Server Members Intent/);
  assert.doesNotMatch(explainError({ code: 99999, message: 'Some raw API text' }), /raw API/);
});

test('une erreur Discord pendant la création est attrapée et expliquée', async () => {
  const g = new FakeGuild();
  g.addMember('Jean');
  g.channels.create = async () => {
    throw Object.assign(new Error('Missing Permissions'), { code: 50013, status: 403 });
  };
  const { manager, log } = makeManager(g);
  const stats = await manager.syncAll();
  assert.equal(stats.errors, 1);
  assert.match(log.text(), /Problème avec le salon de Jean : le bot n'a pas les permissions/);
  assert.doesNotMatch(log.text(), /Missing Permissions/);
});

// ---------- Rôle VA ----------

test('rôle VA donné une seule fois, jamais aux bots ni aux admins', async () => {
  const g = new FakeGuild();
  const jean = g.addMember('Jean');
  const bot = g.addMember('Bot', { bot: true });
  const admin = g.addMember('Admin', { admin: true });
  for (let i = 0; i < 3; i++) await makeManager(g, { vaRoleId: VA_ROLE }).manager.syncAll();
  assert.ok(jean.roles.cache.has(VA_ROLE));
  assert.ok(!bot.roles.cache.has(VA_ROLE));
  assert.ok(!admin.roles.cache.has(VA_ROLE));
  assert.equal(g.roleAdds, 1);
});

test('rôle VA impossible à donner : explication claire, et le salon est quand même créé', async () => {
  const g = new FakeGuild();
  g.addMember('Jean');
  g.failRoleAdd = true;
  const { manager, log } = makeManager(g, { vaRoleId: VA_ROLE });
  await manager.syncAll();
  assert.equal(g.textChannels().length, 1);
  assert.match(log.text(), /au-dessus du rôle VA/i);
});
