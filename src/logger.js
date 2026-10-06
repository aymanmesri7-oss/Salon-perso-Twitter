const time = () =>
  new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'medium' });

export const log = {
  info: (msg) => console.log(`[${time()}] ${msg}`),
  warn: (msg) => console.warn(`[${time()}] ${msg}`),
  error: (msg) => console.error(`[${time()}] ${msg}`),
};
