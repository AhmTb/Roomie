const PUTER_ACCOUNT_LOCK_NAME = "roomie-puter-account";
const PUTER_ACCOUNT_INTENT_LOCK_NAME = "roomie-puter-account-intent";
const PUTER_ACCOUNT_VERSION_KEY = "roomie:puter-account-version";
const PUTER_ACCOUNT_PROBE_KEY = "roomie:puter-account-storage-probe";
const PUTER_ACCOUNT_CHANNEL_NAME = "roomie-puter-account";
const INITIAL_ACCOUNT_VERSION = "initial";
let puterAccountOperation = Promise.resolve();
let puterAccountIntentOperation = Promise.resolve();
const activeAccountLeases = new Set<symbol>();
const accountMutationListeners = new Set<
  (event: PuterAccountMutationEvent) => void
>();
let localAccountVersion = INITIAL_ACCOUNT_VERSION;
let hasInitializedAccountVersion = false;
let accountChannel: BroadcastChannel | null = null;

type PuterAccountMutationEvent = {
  type: "started" | "finished";
  version: string;
};

export type PuterAccountMutation = Readonly<PuterAccountMutationEvent>;

function notifyAccountMutationListeners(event: PuterAccountMutationEvent) {
  for (const listener of accountMutationListeners) {
    try {
      listener(event);
    } catch (error) {
      console.warn("A Roomie account listener failed.", error);
    }
  }
}

function acceptAccountMutation(event: PuterAccountMutationEvent) {
  if (!event.version) return;
  hasInitializedAccountVersion = true;
  localAccountVersion = event.version;
  notifyAccountMutationListeners(event);
}

declare const puterAccountLeaseBrand: unique symbol;
export type PuterAccountLease = symbol & {
  readonly [puterAccountLeaseBrand]: true;
};

export interface PuterAccountLockOptions {
  startIfAvailable?: boolean;
}

function createAccountLease() {
  const lease = Symbol("roomie-puter-account-lease") as PuterAccountLease;
  activeAccountLeases.add(lease);
  return lease;
}

export function hasPuterAccountLease(
  lease: PuterAccountLease | undefined,
) {
  return !!lease && activeAccountLeases.has(lease);
}

function readAccountVersion() {
  if (typeof window === "undefined") return localAccountVersion;

  try {
    const storedVersion = localStorage.getItem(PUTER_ACCOUNT_VERSION_KEY);
    const version = storedVersion || INITIAL_ACCOUNT_VERSION;
    if (!hasInitializedAccountVersion) {
      hasInitializedAccountVersion = true;
      localAccountVersion = version;
      return version;
    }
    if (version !== localAccountVersion) {
      queueMicrotask(() =>
        acceptAccountMutation({ type: "finished", version }),
      );
      return version;
    }
  } catch {
    // Some embedded/private contexts do not expose localStorage.
  }

  return localAccountVersion;
}

function getAccountChannel() {
  if (typeof BroadcastChannel === "undefined") return null;
  if (accountChannel) return accountChannel;

  try {
    const channel = new BroadcastChannel(PUTER_ACCOUNT_CHANNEL_NAME);
    channel.addEventListener(
      "message",
      (event: MessageEvent<PuterAccountMutationEvent>) => {
        if (
          event.data?.type === "started" ||
          event.data?.type === "finished"
        ) {
          acceptAccountMutation(event.data);
        }
      },
    );
    accountChannel = channel;
    return channel;
  } catch {
    accountChannel = null;
    return null;
  }
}

function writeAccountVersion(version: string) {
  hasInitializedAccountVersion = true;
  localAccountVersion = version;

  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(PUTER_ACCOUNT_VERSION_KEY, version);
    } catch {
      // The in-memory version and broadcast still protect this realm.
    }
  }
}

function publishAccountMutation(event: PuterAccountMutationEvent) {
  const channel = getAccountChannel();
  if (!channel) return;

  try {
    channel.postMessage(event);
  } catch {
    try {
      channel.close();
    } catch {
      // The channel is already unusable; the account lock still serializes tabs.
    }
    accountChannel = null;
  }
}

export function hasSharedPuterAccountLock() {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.locks?.request === "function"
  );
}

export function hasReliablePuterAccountCoordination() {
  if (!hasSharedPuterAccountLock() || typeof window === "undefined") {
    return false;
  }

  try {
    const sentinel =
      globalThis.crypto?.randomUUID?.() ||
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(PUTER_ACCOUNT_PROBE_KEY, sentinel);
    const isReliable =
      localStorage.getItem(PUTER_ACCOUNT_PROBE_KEY) === sentinel;
    localStorage.removeItem(PUTER_ACCOUNT_PROBE_KEY);
    return isReliable;
  } catch {
    try {
      localStorage.removeItem(PUTER_ACCOUNT_PROBE_KEY);
    } catch {
      // Storage is unavailable; hosted writes fail closed below.
    }
    return false;
  }
}

export function getPuterAccountVersion() {
  getAccountChannel();
  return readAccountVersion();
}

export function subscribeToPuterAccountMutations(
  listener: (event: PuterAccountMutation) => void,
) {
  accountMutationListeners.add(listener);

  if (typeof window !== "undefined") {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === PUTER_ACCOUNT_VERSION_KEY && event.newValue) {
        acceptAccountMutation({
          type: "finished",
          version: event.newValue,
        });
      }
    };
    const handleFocus = () => {
      readAccountVersion();
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", handleFocus);
    return () => {
      accountMutationListeners.delete(listener);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", handleFocus);
    };
  }

  return () => {
    accountMutationListeners.delete(listener);
  };
}

export function startPuterAccountMutation() {
  const version =
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  writeAccountVersion(version);
  publishAccountMutation({ type: "started", version });
  return version;
}

export function finishPuterAccountMutation(version: string) {
  publishAccountMutation({ type: "finished", version });
}

async function withFallbackLock<T>(
  operation: () => T | Promise<T>,
  getQueue: () => Promise<void>,
  setQueue: (queue: Promise<void>) => void,
) {
  const previousOperation = getQueue();
  let releaseOperation = () => {};
  setQueue(
    new Promise<void>((resolve) => {
      releaseOperation = resolve;
    }),
  );

  await previousOperation;

  try {
    return await operation();
  } finally {
    releaseOperation();
  }
}

export async function withPuterAccountIntentLock<T>(
  operation: () => T | Promise<T>,
) {
  if (hasSharedPuterAccountLock()) {
    return navigator.locks.request(
      PUTER_ACCOUNT_INTENT_LOCK_NAME,
      operation,
    );
  }

  return withFallbackLock(
    operation,
    () => puterAccountIntentOperation,
    (queue) => {
      puterAccountIntentOperation = queue;
    },
  );
}

export async function withPuterAccountLock<T>(
  operation: (lease: PuterAccountLease) => T | Promise<T>,
  options: PuterAccountLockOptions = {},
) {
  const runWithLease = async () => {
    const lease = createAccountLease();

    try {
      return await operation(lease);
    } finally {
      activeAccountLeases.delete(lease);
    }
  };

  if (typeof navigator !== "undefined" && navigator.locks) {
    const lockOptions = options.startIfAvailable
      ? ({ ifAvailable: true } as const)
      : undefined;

    return navigator.locks.request(
      PUTER_ACCOUNT_LOCK_NAME,
      lockOptions ?? {},
      (lock) => (lock ? runWithLease() : null),
    );
  }

  return withFallbackLock(
    runWithLease,
    () => puterAccountOperation,
    (queue) => {
      puterAccountOperation = queue;
    },
  );
}
