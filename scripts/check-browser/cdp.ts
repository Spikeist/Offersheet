/**
 * A minimal Chrome DevTools Protocol client for `npm run check:browser` (no dependency: Node 22's global WebSocket).
 * One connection to the browser; its targets (the page, the page's Web Workers) are reached through flattened
 * sessions (every message carries its sessionId). Commands time out instead of hanging, and a closed socket rejects
 * whatever is still waiting.
 */

/** A protocol event: its method, params and the session it came from (none: the browser itself). */
export interface CdpEvent {
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
}

/** A command's error answer, or a timeout / closed socket. */
export class CdpError extends Error {
  constructor(
    readonly method: string,
    message: string,
  ) {
    super(`${method}: ${message}`);
    this.name = "CdpError";
  }
}

interface Waiting {
  method: string;
  resolve: (result: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Commands answer in well under this; a long Runtime.evaluate passes its own. */
export const CDP_TIMEOUT_MS = 60_000;

export class CdpClient {
  private nextId = 0;
  private readonly waiting = new Map<number, Waiting>();
  private readonly listeners = new Set<(event: CdpEvent) => void>();
  private open = true;

  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener("message", (e: MessageEvent) => this.receive(String(e.data)));
    ws.addEventListener("close", () => this.fail("the browser connection closed"));
    ws.addEventListener("error", () => this.fail("the browser connection failed"));
  }

  /** Connects to a DevTools WebSocket URL (the browser's, from its "DevTools listening on" line). */
  static async connect(url: string, timeoutMs = 15_000): Promise<CdpClient> {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The browser's DevTools connection didn't open.")), timeoutMs);
      const settle = (err?: Error) => {
        clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      };
      ws.addEventListener("open", () => settle(), { once: true });
      ws.addEventListener("error", () => settle(new Error("The browser's DevTools connection failed.")), { once: true });
    });
    return new CdpClient(ws);
  }

  /** Sends a command (to a target when `sessionId` is given) and resolves with its result. */
  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = CDP_TIMEOUT_MS): Promise<T> {
    if (!this.open) return Promise.reject(new CdpError(method, "the browser connection is closed"));
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new CdpError(method, `no answer within ${Math.round(timeoutMs / 1000)} s`));
      }, timeoutMs);
      this.waiting.set(id, { method, resolve: (r) => resolve(r as T), reject, timer });
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
  }

  /** Listens to every event; returns the unsubscribe function. */
  on(listener: (event: CdpEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.fail("the browser connection is closed");
    try {
      this.ws.close();
    } catch {
      // already closed
    }
  }

  private receive(raw: string): void {
    let msg: { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { message?: string }; sessionId?: string };
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      return;
    }
    if (typeof msg.id === "number") {
      const w = this.waiting.get(msg.id);
      if (!w) return;
      this.waiting.delete(msg.id);
      clearTimeout(w.timer);
      if (msg.error) w.reject(new CdpError(w.method, msg.error.message ?? "failed"));
      else w.resolve(msg.result ?? {});
      return;
    }
    if (!msg.method) return;
    const event: CdpEvent = { method: msg.method, params: msg.params ?? {}, ...(msg.sessionId ? { sessionId: msg.sessionId } : {}) };
    for (const l of [...this.listeners]) {
      try {
        l(event);
      } catch {
        // a listener's bug mustn't stop the others
      }
    }
  }

  private fail(why: string): void {
    this.open = false;
    for (const [id, w] of this.waiting) {
      clearTimeout(w.timer);
      w.reject(new CdpError(w.method, why));
      this.waiting.delete(id);
    }
  }
}
