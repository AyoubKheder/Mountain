/**
 * Refresh-token registry — what makes rotation and revocation possible.
 *
 * A signed JWT alone cannot be un-issued, so a stolen refresh token stays valid
 * until it expires (7 days by default). Recording each `jti` on issue lets us:
 *
 *  - rotate: a refresh token is single-use, so the old one is spent;
 *  - detect replay: if a spent token shows up again, someone is holding a copy —
 *    the whole login lineage is revoked;
 *  - revoke a family outright on logout or a password change.
 *
 * Storage is in-process for now, matching the rest of the scaffold. Moving it to
 * Redis is a drop-in change and is required before running more than one API
 * instance (see docs/analysis.md, Track C).
 */

export interface RefreshSession {
  jti: string;
  userId: string;
  family: string;
  expiresAt: number;
  revoked: boolean;
}

const sessions = new Map<string, RefreshSession>();
/** family → jti set, so a lineage can be revoked in one move. */
const families = new Map<string, Set<string>>();

function sweep(now = Date.now()): void {
  for (const [jti, session] of sessions) {
    if (session.expiresAt <= now) {
      sessions.delete(jti);
      families.get(session.family)?.delete(jti);
    }
  }
}

export function rememberSession(session: Omit<RefreshSession, 'revoked'>): void {
  sweep();
  sessions.set(session.jti, { ...session, revoked: false });
  const family = families.get(session.family) ?? new Set<string>();
  family.add(session.jti);
  families.set(session.family, family);
}

export type ConsumeResult =
  | { status: 'ok'; session: RefreshSession }
  | { status: 'replay'; session: RefreshSession }
  | { status: 'unknown' };

/**
 * Spends a refresh token. A second attempt with the same `jti` is reported as a
 * replay rather than silently rejected — the caller uses that to revoke the
 * whole family.
 */
export function consumeSession(jti: string): ConsumeResult {
  sweep();
  const session = sessions.get(jti);
  if (!session) return { status: 'unknown' };
  if (session.revoked) return { status: 'replay', session };

  session.revoked = true;
  return { status: 'ok', session };
}

/** Revokes every token descended from one login. Returns how many were killed. */
export function revokeFamily(family: string): number {
  const jtis = families.get(family);
  if (!jtis) return 0;

  let revoked = 0;
  for (const jti of jtis) {
    const session = sessions.get(jti);
    if (session && !session.revoked) {
      session.revoked = true;
      revoked += 1;
    }
  }
  return revoked;
}

export function revokeUser(userId: string): number {
  let revoked = 0;
  for (const session of sessions.values()) {
    if (session.userId === userId && !session.revoked) {
      session.revoked = true;
      revoked += 1;
    }
  }
  return revoked;
}

export function activeSessionCount(): number {
  sweep();
  return [...sessions.values()].filter((session) => !session.revoked).length;
}

/** Test helper. */
export function resetRefreshStore(): void {
  sessions.clear();
  families.clear();
}
