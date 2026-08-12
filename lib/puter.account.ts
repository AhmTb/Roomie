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
