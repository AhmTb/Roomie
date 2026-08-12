// Puter.js 2.6.0 does not expose its storage keys as public API. Keep the
// compatibility boundary in one place so an SDK upgrade has one auditable
// contract to update and test.
export const PUTER_AUTH_STORAGE_KEYS = Object.freeze({
  token: "puter.auth.token.v2",
  origin: "puter.auth.token.origin.v2",
});

interface PuterAuthTokenClient {
  APIOrigin: string;
  defaultAPIOrigin: string;
  authToken?: string | null;
  setAuthToken: (token: string) => void;
  resetAuthToken: () => void;
}

function normalizeStoredValue(value: string | null) {
  if (!value) return null;
  const normalized = value.trim();
  return normalized && normalized !== "null" && normalized !== "undefined"
    ? normalized
    : null;
}

export function readStoredPuterAuth(storage: Pick<Storage, "getItem">) {
  return {
    token: normalizeStoredValue(storage.getItem(PUTER_AUTH_STORAGE_KEYS.token)),
    origin: normalizeStoredValue(
      storage.getItem(PUTER_AUTH_STORAGE_KEYS.origin),
    ),
  };
}

export function synchronizeStoredPuterAuth(
  storage: Pick<Storage, "getItem">,
  client: PuterAuthTokenClient,
  onError?: (error: unknown) => void,
) {
  try {
    // Read the complete compatibility tuple before a mismatch can reset the
    // SDK and remove either key from the same storage object.
    const { token, origin } = readStoredPuterAuth(storage);
    const currentOrigin = new URL(client.APIOrigin).origin;
    const defaultOrigin = new URL(client.defaultAPIOrigin).origin;
    let isOriginAllowed = currentOrigin === defaultOrigin;

    if (origin) {
      try {
        isOriginAllowed = new URL(origin).origin === currentOrigin;
      } catch {
        isOriginAllowed = false;
      }
    }

    if (!token || !isOriginAllowed) {
      client.resetAuthToken();
      return false;
    }

    if (client.authToken !== token) {
      client.setAuthToken(token);
    }
    return true;
  } catch (error) {
    try {
      client.resetAuthToken();
    } catch {
      // The client is already unusable; the auth refresh will fail closed.
    }
    onError?.(error);
    return false;
  }
}
