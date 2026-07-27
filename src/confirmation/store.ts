export type ConfirmationRecord = {
  token: string;
  toolName: string;
  argsHash: string;
  expiresAt: number;
  used: boolean;
  /** Identity the token was issued to, when `identify()` is configured. */
  identity?: string;
  /** Epoch millis the record was created. */
  issuedAt?: number;
};

export interface ConfirmationStore {
  set(record: ConfirmationRecord): Promise<void>;
  get(token: string): Promise<ConfirmationRecord | undefined>;
  markUsed(token: string): Promise<void>;
  /** Optional: drop a record outright. Used by `revokeConfirmation()`. */
  delete?(token: string): Promise<void>;
  /** Optional: evict expired records. Called opportunistically. */
  sweep?(): Promise<number>;
}

export type InMemoryConfirmationStoreOptions = {
  /**
   * Cap on stored records. Oldest are evicted past this so an agent looping on
   * a confirmation-gated tool cannot grow memory without bound. Default: 10_000.
   */
  maxEntries?: number;
};

export class InMemoryConfirmationStore implements ConfirmationStore {
  private readonly map = new Map<string, ConfirmationRecord>();
  private readonly maxEntries: number;

  constructor(options: InMemoryConfirmationStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? 10_000;
  }

  async set(record: ConfirmationRecord): Promise<void> {
    if (this.map.size >= this.maxEntries) {
      await this.sweep();
      if (this.map.size >= this.maxEntries) {
        const oldest = this.map.keys().next();
        if (!oldest.done) this.map.delete(oldest.value);
      }
    }
    this.map.set(record.token, record);
  }

  async get(token: string): Promise<ConfirmationRecord | undefined> {
    const record = this.map.get(token);
    if (!record) return undefined;
    if (record.expiresAt < Date.now()) {
      this.map.delete(token);
      return undefined;
    }
    return record;
  }

  async markUsed(token: string): Promise<void> {
    const record = this.map.get(token);
    if (record) {
      record.used = true;
      this.map.set(token, record);
    }
  }

  async delete(token: string): Promise<void> {
    this.map.delete(token);
  }

  async sweep(): Promise<number> {
    const now = Date.now();
    let removed = 0;
    for (const [token, record] of this.map) {
      if (record.expiresAt < now || record.used) {
        this.map.delete(token);
        removed++;
      }
    }
    return removed;
  }

  /** Live record count, for diagnostics and tests. */
  get size(): number {
    return this.map.size;
  }
}

/** Default lifetime of a confirmation token. Override via `confirmation.ttlMs`. */
export const CONFIRMATION_TTL_MS = 5 * 60 * 1000;
