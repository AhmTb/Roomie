const GENERATION_ATTEMPTS_KEY = "roomie:ai-generation-attempts:v1";
const GENERATION_ATTEMPT_LOCK_NAME = "roomie-ai-generation-attempts";
const MAX_DATE_TIMESTAMP = 8_640_000_000_000_000;

type GenerationAttempt = {
  ownerUserId: string;
  projectId: string;
  sourceImage: string;
  attemptedAt: number;
};

type AttemptStorage = Pick<Storage, "getItem" | "setItem">;

type AttemptLockManager = {
  request<T>(name: string, callback: () => T | Promise<T>): Promise<T>;
};

type ClaimAttemptDependencies = {
  storage: AttemptStorage;
  locks: AttemptLockManager;
  now: () => number;
};

function isGenerationAttempt(value: unknown): value is GenerationAttempt {
  if (!value || typeof value !== "object") return false;
  const attempt = value as Partial<GenerationAttempt>;
  return (
    typeof attempt.ownerUserId === "string" &&
    !!attempt.ownerUserId &&
    typeof attempt.projectId === "string" &&
    !!attempt.projectId &&
    typeof attempt.sourceImage === "string" &&
    !!attempt.sourceImage &&
    typeof attempt.attemptedAt === "number" &&
    Number.isFinite(attempt.attemptedAt) &&
    attempt.attemptedAt >= 0 &&
    attempt.attemptedAt <= MAX_DATE_TIMESTAMP
  );
}

function readAttempts(storage: AttemptStorage) {
  const stored = storage.getItem(GENERATION_ATTEMPTS_KEY);
  if (!stored) return [];

  const parsed: unknown = JSON.parse(stored);
  return Array.isArray(parsed) ? parsed.filter(isGenerationAttempt) : [];
}

export async function claimAutomaticGenerationAttemptWithDependencies(
  request: Omit<GenerationAttempt, "attemptedAt">,
  dependencies: ClaimAttemptDependencies,
) {
  if (
    !request.ownerUserId ||
    !request.projectId ||
    !request.sourceImage ||
    !dependencies.storage ||
    !dependencies.locks
  ) {
    return false;
  }

  try {
    return await dependencies.locks.request(GENERATION_ATTEMPT_LOCK_NAME, () => {
      const attempts = readAttempts(dependencies.storage);
      const alreadyAttempted = attempts.some(
        (attempt) =>
          attempt.ownerUserId === request.ownerUserId &&
          attempt.projectId === request.projectId &&
          attempt.sourceImage === request.sourceImage,
      );
      if (alreadyAttempted) return false;

      const nextAttempts = [
        ...attempts,
        { ...request, attemptedAt: dependencies.now() },
      ];
      dependencies.storage.setItem(
        GENERATION_ATTEMPTS_KEY,
        JSON.stringify(nextAttempts),
      );
      return true;
    });
  } catch {
    // Charging a user twice is worse than requiring an explicit retry.
    return false;
  }
}

export function claimAutomaticGenerationAttempt(
  request: Omit<GenerationAttempt, "attemptedAt">,
) {
  if (
    typeof window === "undefined" ||
    typeof navigator === "undefined" ||
    typeof navigator.locks?.request !== "function"
  ) {
    return Promise.resolve(false);
  }

  try {
    return claimAutomaticGenerationAttemptWithDependencies(request, {
      storage: window.localStorage,
      locks: navigator.locks,
      now: Date.now,
    });
  } catch {
    return Promise.resolve(false);
  }
}
