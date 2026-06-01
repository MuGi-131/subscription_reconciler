export type EntitlementSource = "STORE" | "CARRIER" | "MARKETPLACE" | "NONE";

export interface Entitlement {
  userId: string;
  active: boolean;
  source: EntitlementSource;
  expiresAt: Date | null;
  lastChangedAt: Date;
  reason: string | null;
}

export interface DbEntitlement {
  user_id: string;
  active: boolean;
  source: EntitlementSource;
  expires_at: Date | null;
  last_changed_at: Date;
  reason: string | null;
  last_event_time: string | null; // BIGINT is usually returned as string by pg
}

