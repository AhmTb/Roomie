import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const TOKEN_KEY = "puter.auth.token.v2";
const ORIGIN_KEY = "puter.auth.token.origin.v2";

async function loadCompatibilityModule() {
  return import(
    new URL("../lib/puter.auth-storage.ts", import.meta.url).href
  );
}

test("reads Puter 2.6.0 token and origin compatibility keys in order", async () => {
  const { PUTER_AUTH_STORAGE_KEYS, readStoredPuterAuth } =
    await loadCompatibilityModule();
  const reads = [];
  const stored = new Map([
    [TOKEN_KEY, " token-A "],
    [ORIGIN_KEY, " https://api.puter.com "],
  ]);

  const auth = readStoredPuterAuth({
    getItem(key) {
      reads.push(key);
      return stored.get(key) ?? null;
    },
  });

  assert.deepEqual(PUTER_AUTH_STORAGE_KEYS, {
    token: TOKEN_KEY,
    origin: ORIGIN_KEY,
  });
  assert.deepEqual(reads, [TOKEN_KEY, ORIGIN_KEY]);
  assert.deepEqual(auth, {
    token: "token-A",
    origin: "https://api.puter.com",
  });
});

test("pinned Puter 2.6.0 declares the compatibility keys", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const sdkManifest = JSON.parse(
    await readFile(
      new URL(
        "../node_modules/@heyputer/puter.js/package.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const sdkSource = await readFile(
    new URL(
      "../node_modules/@heyputer/puter.js/src/index.js",
      import.meta.url,
    ),
    "utf8",
  );

  assert.equal(manifest.dependencies["@heyputer/puter.js"], "2.6.0");
  assert.equal(sdkManifest.version, "2.6.0");
  assert.match(
    sdkSource,
    /const STORAGE_KEY_V2 = ['"]puter\.auth\.token\.v2['"];/,
  );
  assert.match(
    sdkSource,
    /const STORAGE_KEY_ORIGIN_V2 = ['"]puter\.auth\.token\.origin\.v2['"];/,
  );
});

test("both compatibility reads complete before mismatch handling can run", async () => {
  const { synchronizeStoredPuterAuth } = await loadCompatibilityModule();
  const events = [];
  const synchronized = synchronizeStoredPuterAuth(
    {
      getItem(key) {
        events.push(`read:${key}`);
        return key === TOKEN_KEY ? "token-A" : "https://foreign.example";
      },
    },
    {
      APIOrigin: "https://api.puter.com",
      defaultAPIOrigin: "https://api.puter.com",
      authToken: "old-token",
      setAuthToken() {
        events.push("set");
      },
      resetAuthToken() {
        events.push("reset");
      },
    },
  );

  assert.equal(synchronized, false);
  assert.deepEqual(events, [
    `read:${TOKEN_KEY}`,
    `read:${ORIGIN_KEY}`,
    "reset",
  ]);
});
