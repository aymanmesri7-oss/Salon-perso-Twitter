export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Garantit au moins `ms` millisecondes entre deux actions Discord. */
export class Pacer {
  constructor(ms = 1000) {
    this.ms = ms;
    this.last = 0;
    this.chain = Promise.resolve();
  }
  wait() {
    const p = this.chain.then(async () => {
      const delay = this.last + this.ms - Date.now();
      if (delay > 0) await sleep(delay);
      this.last = Date.now();
    });
    this.chain = p.catch(() => {});
    return p;
  }
}

/** File d'attente : une seule opération à la fois, dans l'ordre d'arrivée. */
export class SerialQueue {
  constructor() {
    this.tail = Promise.resolve();
  }
  run(fn) {
    const r = this.tail.then(fn);
    this.tail = r.catch(() => {});
    return r;
  }
}

/** Limite Discord : 2 renommages par salon par tranche de 10 minutes. */
export class EditGuard {
  constructor({ max = 2, windowMs = 10 * 60 * 1000, now = () => Date.now() } = {}) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
    this.history = new Map();
  }
  recent(id) {
    const t = this.now();
    const list = (this.history.get(id) ?? []).filter((x) => t - x < this.windowMs);
    this.history.set(id, list);
    return list;
  }
  check(id) {
    const list = this.recent(id);
    if (list.length < this.max) return { ok: true, waitMs: 0 };
    return { ok: false, waitMs: list[0] + this.windowMs - this.now() };
  }
  record(id) {
    this.recent(id).push(this.now());
  }
}
