const GENERATION_ATTEMPTS_KEY = "roomie:ai-generation-attempts:v1";
const GENERATION_ATTEMPT_LOCK_NAME = "roomie-ai-generation-attempts";
const RESERVATION_TTL_MS = 5 * 60 * 1_000;
const MAX_DATE_TIMESTAMP = 8_640_000_000_000_000;

type GenerationAttemptIdentity = {
  ownerUserId: string;
  projectId: string;
  sourceImage: string;
};

type StoredGenerationAttempt = GenerationAttemptIdentity & {
  phase: "reserved" | "started";
  claimId: string;
  updatedAt: number;
};

type LegacyGenerationAttempt = GenerationAttemptIdentity & {
  attemptedAt: number;
};

export type AutomaticGenerationLease = GenerationAttemptIdentity & {
  claimId: string;
};

type AttemptStorage = Pick<Storage, "getItem" | "setItem">;

type AttemptLockManager = {
  request<T>(name: string, callback: () => T | Promise<T>): Promise<T>;
};

type ClaimAttemptDependencies = {
  storage: AttemptStorage;
  locks: AttemptLockManager;
  now: () => number;
  createClaimId: () => string;
};

function isAttemptIdentity(value: unknown): value is GenerationAttemptIdentity {
  if (!value || typeof value !== "object") return false;
  const attempt = value as Partial<GenerationAttemptIdentity>;
  return (
    typeof attempt.ownerUserId === "string" &&
    !!attempt.ownerUserId &&
    typeof attempt.projectId === "string" &&
    !!attempt.projectId &&
    typeof attempt.sourceImage === "string" &&
    !!attempt.sourceImage
  );
}

function isValidTimestamp(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_DATE_TIMESTAMP
  );
}

function normalizeStoredAttempt(value: unknown): StoredGenerationAttempt | null {
  if (!isAttemptIdentity(value)) return null;
  const identity = value;
  const attempt = value as Partial<StoredGenerationAttempt & LegacyGenerationAttempt>;

  if (
    (attempt.phase === "reserved" || attempt.phase === "started") &&
    typeof attempt.claimId === "string" &&
    !!attempt.claimId &&
    isValidTimestamp(attempt.updatedAt)
  ) {
    return {
      ownerUserId: identity.ownerUserId,
      projectId: identity.projectId,
      sourceImage: identity.sourceImage,
      phase: attempt.phase,
      claimId: attempt.claimId,
      updatedAt: attempt.updatedAt,
    };
  }

  // Existing v1 entries represent attempts that may already have been billed.
  if (isValidTimestamp(attempt.attemptedAt)) {
    return {
      ownerUserId: identity.ownerUserId,
      projectId: identity.projectId,
      sourceImage: identity.sourceImage,
      phase: "started",
      claimId: `legacy-${attempt.attemptedAt}`,
      updatedAt: attempt.attemptedAt,
    };
  }

  return null;
}

function readAttempts(storage: AttemptStorage) {
  const stored = storage.getItem(GENERATION_ATTEMPTS_KEY);
  if (!stored) return { attempts: [] as StoredGenerationAttempt[], corrupt: false };

  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return { attempts: [], corrupt: true };
    const attempts = parsed
      .map(normalizeStoredAttempt)
      .filter((attempt): attempt is StoredGenerationAttempt => !!attempt);
    return {
      attempts,
      corrupt: attempts.length !== parsed.length,
    };
  } catch {
    return { attempts: [] as StoredGenerationAttempt[], corrupt: true };
  }
}

function sameIdentity(
  left: GenerationAttemptIdentity,
  right: GenerationAttemptIdentity,
) {
  return (
    left.ownerUserId === right.ownerUserId &&
    left.projectId === right.projectId &&
    left.sourceImage === right.sourceImage
  );
}

function writeAttempts(
  storage: AttemptStorage,
  attempts: StoredGenerationAttempt[],
) {
  storage.setItem(GENERATION_ATTEMPTS_KEY, JSON.stringify(attempts));
}

function repairCorruptStorage(
  storage: AttemptStorage,
  validAttempts: StoredGenerationAttempt[],
  request: GenerationAttemptIdentity,
  now: number,
) {
  // Corrupt storage cannot prove whether this source was already billed. Mark
  // only this source as started so other projects recover without risking an
  // automatic duplicate charge here.
  writeAttempts(storage, [
    ...validAttempts.filter((attempt) => !sameIdentity(attempt, request)),
    {
      ...request,
      phase: "started",
      claimId: `recovered-${now}`,
      updatedAt: now,
    },
  ]);
}

function isValidLease(value: unknown): value is AutomaticGenerationLease {
  return (
    isAttemptIdentity(value) &&
    typeof (value as Partial<AutomaticGenerationLease>).claimId === "string" &&
    !!(value as Partial<AutomaticGenerationLease>).claimId
  );
}

export async function claimAutomaticGenerationAttemptWithDependencies(
  request: GenerationAttemptIdentity,
  dependencies: ClaimAttemptDependencies,
): Promise<AutomaticGenerationLease | null> {
  if (
    !isAttemptIdentity(request) ||
    !dependencies.storage ||
    !dependencies.locks
  ) {
    return null;
  }

  try {
    return await dependencies.locks.request(GENERATION_ATTEMPT_LOCK_NAME, () => {
      const now = dependencies.now();
      if (!isValidTimestamp(now)) return null;

      const { attempts, corrupt } = readAttempts(dependencies.storage);
      if (corrupt) {
        repairCorruptStorage(dependencies.storage, attempts, request, now);
        return null;
      }

      const activeAttempts = attempts.filter(
        (attempt) =>
          attempt.phase === "started" || now - attempt.updatedAt < RESERVATION_TTL_MS,
      );
      if (activeAttempts.some((attempt) => sameIdentity(attempt, request))) {
        if (activeAttempts.length !== attempts.length) {
          writeAttempts(dependencies.storage, activeAttempts);
        }
        return null;
      }

      const claimId = dependencies.createClaimId();
      if (!claimId) return null;
      const lease = { ...request, claimId };
      writeAttempts(dependencies.storage, [
        ...activeAttempts,
        { ...lease, phase: "reserved", updatedAt: now },
      ]);
      return lease;
    });
  } catch {
    // Charging a user twice is worse than requiring an explicit retry.
    return null;
  }
}

export async function commitAutomaticGenerationAttemptWithDependencies(
  lease: AutomaticGenerationLease,
  dependencies: ClaimAttemptDependencies,
  signal?: AbortSignal,
) {
  if (!isValidLease(lease) || !dependencies.storage || !dependencies.locks) {
    return false;
  }

  try {
    return await dependencies.locks.request(GENERATION_ATTEMPT_LOCK_NAME, () => {
      if (signal?.aborted) return false;
      const now = dependencies.now();
      if (!isValidTimestamp(now)) return false;

      const { attempts, corrupt } = readAttempts(dependencies.storage);
      if (corrupt) {
        repairCorruptStorage(dependencies.storage, attempts, lease, now);
        return false;
      }

      const index = attempts.findIndex(
        (attempt) =>
          sameIdentity(attempt, lease) &&
          attempt.claimId === lease.claimId &&
          attempt.phase === "reserved",
      );
      if (index < 0) return false;

      const nextAttempts = [...attempts];
      nextAttempts[index] = {
        ...nextAttempts[index],
        phase: "started",
        updatedAt: now,
      };
      writeAttempts(dependencies.storage, nextAttempts);
      return true;
    });
  } catch {
    return false;
  }
}

export async function releaseAutomaticGenerationAttemptWithDependencies(
  lease: AutomaticGenerationLease,
  dependencies: ClaimAttemptDependencies,
) {
  if (!isValidLease(lease) || !dependencies.storage || !dependencies.locks) {
    return false;
  }

  try {
    return await dependencies.locks.request(GENERATION_ATTEMPT_LOCK_NAME, () => {
      const now = dependencies.now();
      if (!isValidTimestamp(now)) return false;
      const { attempts, corrupt } = readAttempts(dependencies.storage);
      if (corrupt) {
        repairCorruptStorage(dependencies.storage, attempts, lease, now);
        return false;
      }

      const index = attempts.findIndex(
        (attempt) =>
          sameIdentity(attempt, lease) &&
          attempt.claimId === lease.claimId &&
          attempt.phase === "reserved",
      );
      if (index < 0) return false;

      writeAttempts(
        dependencies.storage,
        attempts.filter((_, attemptIndex) => attemptIndex !== index),
      );
      return true;
    });
  } catch {
    return false;
  }
}

function getBrowserDependencies(): ClaimAttemptDependencies | null {
  if (
    typeof window === "undefined" ||
    typeof navigator === "undefined" ||
    typeof navigator.locks?.request !== "function" ||
    typeof globalThis.crypto?.randomUUID !== "function"
  ) {
    return null;
  }

  try {
    return {
      storage: window.localStorage,
      locks: navigator.locks,
      now: Date.now,
      createClaimId: () => globalThis.crypto.randomUUID(),
    };
  } catch {
    return null;
  }
}

export function claimAutomaticGenerationAttempt(
  request: GenerationAttemptIdentity,
) {
  const dependencies = getBrowserDependencies();
  return dependencies
    ? claimAutomaticGenerationAttemptWithDependencies(request, dependencies)
    : Promise.resolve(null);
}

export function commitAutomaticGenerationAttempt(
  lease: AutomaticGenerationLease,
  signal?: AbortSignal,
) {
  const dependencies = getBrowserDependencies();
  return dependencies
    ? commitAutomaticGenerationAttemptWithDependencies(
        lease,
        dependencies,
        signal,
      )
    : Promise.resolve(false);
}

export function releaseAutomaticGenerationAttempt(
  lease: AutomaticGenerationLease,
) {
  const dependencies = getBrowserDependencies();
  return dependencies
    ? releaseAutomaticGenerationAttemptWithDependencies(lease, dependencies)
    : Promise.resolve(false);
}
