import puter from "@heyputer/puter.js";

const PUTER_ACCOUNT_LOCK_NAME = "roomie-puter-account";
let puterAccountOperation = Promise.resolve();

export async function withPuterAccountLock<T>(
  operation: () => T | Promise<T>,
) {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(PUTER_ACCOUNT_LOCK_NAME, operation);
  }

  const previousOperation = puterAccountOperation;
  let releaseOperation = () => {};
  puterAccountOperation = new Promise<void>((resolve) => {
    releaseOperation = resolve;
  });

  await previousOperation;

  try {
    return await operation();
  } finally {
    releaseOperation();
  }
}

export const signIn = async () =>
  withPuterAccountLock(() => puter.auth.signIn());

export const signOut = async () =>
  withPuterAccountLock(() => puter.auth.signOut());

export const getCurrentUser = async () => {
  try {
    return await puter.auth.getUser();
  } catch (error) {
    console.error("Error getting current user:", error);
    return null;
  }
};
