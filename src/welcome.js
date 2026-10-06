import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export const WELCOME_BUTTON_ID = 'va-bienvenue-ok';

const DEFAULT_TEXT =
  'Bienvenue {membre} ! 👋\n\n' +
  "Ce salon est **privé** : seuls toi et l'équipe admin pouvez le voir.\n" +
  "C'est ici que tu poses tes questions, envoies tes rapports et reçois tes consignes.\n\n" +
  'Clique sur le bouton ci-dessous pour confirmer que tu as bien lu ce message.';

export function buildWelcome(member, customText = null) {
  const content = (customText || DEFAULT_TEXT).replaceAll('{membre}', `<@${member.id}>`);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(WELCOME_BUTTON_ID).setLabel("C'est noté ✅").setStyle(ButtonStyle.Success)
  );
  return { content, components: [row], allowedMentions: { users: [member.id] } };
}

/** Vrai si ce message est notre message de bienvenue. */
export function isWelcomeMessage(message, botId) {
  if (message?.author?.id !== botId) return false;
  return (message.components ?? []).some((row) =>
    (row.components ?? []).some((c) => (c.customId ?? c.data?.custom_id) === WELCOME_BUTTON_ID)
  );
}
