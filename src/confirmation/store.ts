export type ConfirmationRecord = {
  token: string;
  toolName: string;
  argsHash: string;
  expiresAt: number;
  used: boolean;
};

export interface ConfirmationStore {
  set(record: ConfirmationRecord): Promise<void>;
  get(token: string): Promise<ConfirmationRecord | undefined>;
  markUsed(token: string): Promise<void>;
}

export class InMemoryConfirmationStore implements ConfirmationStore {
  private readonly map = new Map<string, ConfirmationRecord>();

  async set(record: ConfirmationRecord): Promise<void> {
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
}

export const CONFIRMATION_TTL_MS = 5 * 60 * 1000;
