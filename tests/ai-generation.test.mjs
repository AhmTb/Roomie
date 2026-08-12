import assert from "node:assert/strict";
import test from "node:test";

async function loadGenerationModule() {
  return import(new URL("../lib/ai.generation.ts", import.meta.url).href);
}

const SOURCE_DATA_URL = "data:image/png;base64,c291cmNl";
const RENDER_DATA_URL = "data:image/png;base64,cmVuZGVy";

function createHarness(overrides = {}) {
  const events = [];
  let accountVersion = "version-1";
  let ownerUserId = "owner-1";
  let aiResponse = { src: RENDER_DATA_URL };
  const puterClient = {
    auth: {
      async getUser() {
        events.push("auth:getUser");
        return { uuid: ownerUserId };
      },
    },
    ai: {
      async txt2img(prompt, options) {
        events.push({ type: "ai:txt2img", prompt, options });
        return aiResponse;
      },
    },
  };

  const dependencies = {
    puterClient,
    async normalizeGeneratedImage(url, signal) {
      signal?.throwIfAborted();
      events.push({ type: "fetch", url });
      return url;
    },
    getAccountVersion() {
      return accountVersion;
    },
    hasReliableAccountCoordination() {
      return true;
    },
    async withAccountIntentLock(operation) {
      events.push("lock:intent:start");
      try {
        return await operation();
      } finally {
        events.push("lock:intent:end");
      }
    },
    async withAccountLock(operation) {
      events.push("lock:account:start");
      try {
        return await operation(Symbol("test-lease"));
      } finally {
        events.push("lock:account:end");
      }
    },
    ...overrides,
  };

  return {
    dependencies,
    events,
    setAccountVersion(value) {
      accountVersion = value;
    },
    setOwnerUserId(value) {
      ownerUserId = value;
    },
    setAIResponse(value) {
      aiResponse = value;
    },
  };
}

function createRequest(signal) {
  return {
    sourceImage:
      "https://roomie.puter.site/projects/project-1/source.png",
    expectedOwnerUserId: "owner-1",
    authorization: {
      expectedOwnerUserId: "owner-1",
      accountVersion: "version-1",
    },
    signal,
  };
}

const preparedSource = {
  dataUrl: SOURCE_DATA_URL,
  mimeType: "image/png",
};

test("generates with the pinned Puter image-to-image contract", async () => {
  const { generate3DViewWithDependencies, ROOMIE_RENDER_PROMPT } =
    await loadGenerationModule();
  const harness = createHarness();

  const result = await generate3DViewWithDependencies(
    createRequest(),
    preparedSource,
    harness.dependencies,
  );
  const aiCall = harness.events.find(
    (event) => event && typeof event === "object" && event.type === "ai:txt2img",
  );

  assert.deepEqual(result, {
    renderedImage: RENDER_DATA_URL,
    renderedPath: undefined,
  });
  assert.equal(aiCall.prompt, ROOMIE_RENDER_PROMPT);
  assert.deepEqual(aiCall.options, {
    provider: "gemini",
    model: "nano-banana",
    input_image: SOURCE_DATA_URL,
    input_image_mime_type: "image/png",
    quality: "1K",
  });
  assert.equal(Object.hasOwn(aiCall.options, "ratio"), false);
  assert.deepEqual(
    harness.events.filter(
      (event) => event && typeof event === "object" && event.type === "fetch",
    ),
    [{ type: "fetch", url: RENDER_DATA_URL }],
  );
  assert.equal(harness.events.at(0), "lock:intent:start");
  assert.ok(harness.events.includes("lock:intent:end"));
  assert.ok(
    harness.events.indexOf("lock:intent:end") <
      harness.events.findIndex(
        (event) => event && typeof event === "object" && event.type === "fetch",
      ),
  );
});

test("uses a topology-locked orthographic image-editing prompt", async () => {
  const { ROOMIE_RENDER_PROMPT } = await loadGenerationModule();

  assert.match(ROOMIE_RENDER_PROMPT, /immutable blueprint/);
  assert.match(
    ROOMIE_RENDER_PROMPT,
    /original orientation—portrait, landscape, or square/,
  );
  assert.match(ROOMIE_RENDER_PROMPT, /original canvas aspect ratio/);
  assert.match(ROOMIE_RENDER_PROMPT, /locked spatial constraint/);
  assert.match(ROOMIE_RENDER_PROMPT, /hidden semantic evidence/);
  assert.match(ROOMIE_RENDER_PROMPT, /Never convert one labeled room type/);
  assert.match(ROOMIE_RENDER_PROMPT, /REMOVE ALL TEXT AND DRAFTING MARKS/);
  assert.match(ROOMIE_RENDER_PROMPT, /true 90-degree orthographic/);
  assert.match(
    ROOMIE_RENDER_PROMPT,
    /Keep each item's exact count, footprint, position, and orientation/,
  );
  assert.match(ROOMIE_RENDER_PROMPT, /as if overlaying both images/);
  assert.match(ROOMIE_RENDER_PROMPT, /no isometric angle/);
  assert.doesNotMatch(ROOMIE_RENDER_PROMPT, /modern sectional/i);
  assert.doesNotMatch(ROOMIE_RENDER_PROMPT, /outdoor seating/i);
});

test("fails before invoking AI when the owner does not match", async () => {
  const { generate3DViewWithDependencies } = await loadGenerationModule();
  const harness = createHarness();
  harness.setOwnerUserId("owner-2");

  await assert.rejects(
    generate3DViewWithDependencies(
      createRequest(),
      preparedSource,
      harness.dependencies,
    ),
    /signed-in Puter account changed/i,
  );
  assert.equal(
    harness.events.some(
      (event) => event && typeof event === "object" && event.type === "ai:txt2img",
    ),
    false,
  );
});

test("rejects a stale result if the account version changes during AI", async () => {
  const { generate3DViewWithDependencies } = await loadGenerationModule();
  const harness = createHarness();
  harness.dependencies.puterClient.ai.txt2img = async (prompt, options) => {
    harness.events.push({ type: "ai:txt2img", prompt, options });
    harness.setAccountVersion("version-2");
    return { src: RENDER_DATA_URL };
  };

  await assert.rejects(
    generate3DViewWithDependencies(
      createRequest(),
      preparedSource,
      harness.dependencies,
    ),
    /Puter account changed during AI generation/i,
  );
  assert.equal(
    harness.events.filter(
      (event) => event && typeof event === "object" && event.type === "ai:txt2img",
    ).length,
    1,
  );
});

test("rejects a version change that occurs during an owner check", async () => {
  const { generate3DViewWithDependencies } = await loadGenerationModule();
  const harness = createHarness();
  harness.dependencies.puterClient.auth.getUser = async () => {
    harness.events.push("auth:getUser");
    harness.setAccountVersion("version-2");
    return { uuid: "owner-1" };
  };

  await assert.rejects(
    generate3DViewWithDependencies(
      createRequest(),
      preparedSource,
      harness.dependencies,
    ),
    /Puter account changed during AI generation/i,
  );
  assert.equal(
    harness.events.some(
      (event) => event && typeof event === "object" && event.type === "ai:txt2img",
    ),
    false,
  );
});

test("honors an already-aborted request without invoking AI", async () => {
  const { generate3DViewWithDependencies } = await loadGenerationModule();
  const harness = createHarness();
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    generate3DViewWithDependencies(
      createRequest(controller.signal),
      preparedSource,
      harness.dependencies,
    ),
    { name: "AbortError" },
  );
  assert.equal(
    harness.events.some(
      (event) => event && typeof event === "object" && event.type === "ai:txt2img",
    ),
    false,
  );
});

test("does not invoke AI when aborted during the final owner check", async () => {
  const { generate3DViewWithDependencies } = await loadGenerationModule();
  const harness = createHarness();
  const controller = new AbortController();
  let ownerChecks = 0;
  harness.dependencies.puterClient.auth.getUser = async () => {
    harness.events.push("auth:getUser");
    ownerChecks += 1;
    if (ownerChecks === 2) controller.abort();
    return { uuid: "owner-1" };
  };

  await assert.rejects(
    generate3DViewWithDependencies(
      createRequest(controller.signal),
      preparedSource,
      harness.dependencies,
    ),
    { name: "AbortError" },
  );
  assert.equal(ownerChecks, 2);
  assert.equal(
    harness.events.some(
      (event) => event && typeof event === "object" && event.type === "ai:txt2img",
    ),
    false,
  );
});

test("fails closed when cross-tab account coordination is unavailable", async () => {
  const { generate3DViewWithDependencies } = await loadGenerationModule();
  const harness = createHarness({
    hasReliableAccountCoordination() {
      return false;
    },
  });

  await assert.rejects(
    generate3DViewWithDependencies(
      createRequest(),
      preparedSource,
      harness.dependencies,
    ),
    /cannot safely coordinate AI generation/i,
  );
  assert.deepEqual(harness.events, []);
});

test("rejects an invalid prepared source before invoking AI", async () => {
  const { generate3DViewWithDependencies } = await loadGenerationModule();
  const harness = createHarness();

  await assert.rejects(
    generate3DViewWithDependencies(
      createRequest(),
      { dataUrl: "data:text/plain;base64,bm90LWltYWdl", mimeType: "image/png" },
      harness.dependencies,
    ),
    /source image payload is invalid/i,
  );
  assert.deepEqual(harness.events, []);
});

test("fails when the account lock cannot be acquired", async () => {
  const { generate3DViewWithDependencies } = await loadGenerationModule();
  const harness = createHarness({
    async withAccountLock() {
      return null;
    },
  });

  await assert.rejects(
    generate3DViewWithDependencies(
      createRequest(),
      preparedSource,
      harness.dependencies,
    ),
    /could not acquire the Puter account lock/i,
  );
  assert.equal(
    harness.events.some(
      (event) => event && typeof event === "object" && event.type === "ai:txt2img",
    ),
    false,
  );
});

test("requires an automatic lease commit immediately before invoking AI", async () => {
  const { generate3DViewWithDependencies } = await loadGenerationModule();
  const harness = createHarness();

  await generate3DViewWithDependencies(
    createRequest(),
    preparedSource,
    harness.dependencies,
    {
      async beforeProviderRequest() {
        harness.events.push("attempt:started");
        return true;
      },
    },
  );

  const providerIndex = harness.events.findIndex(
    (event) => event && typeof event === "object" && event.type === "ai:txt2img",
  );
  assert.equal(harness.events[providerIndex - 1], "attempt:started");
});

test("does not invoke AI when an automatic lease cannot commit", async () => {
  const { generate3DViewWithDependencies } = await loadGenerationModule();
  const harness = createHarness();

  await assert.rejects(
    generate3DViewWithDependencies(
      createRequest(),
      preparedSource,
      harness.dependencies,
      { beforeProviderRequest: async () => false },
    ),
    /reservation is no longer valid/i,
  );
  assert.equal(
    harness.events.some(
      (event) => event && typeof event === "object" && event.type === "ai:txt2img",
    ),
    false,
  );
});

test("does not invoke AI when cancellation follows an automatic lease commit", async () => {
  const { generate3DViewWithDependencies } = await loadGenerationModule();
  const controller = new AbortController();
  const harness = createHarness();

  await assert.rejects(
    generate3DViewWithDependencies(
      createRequest(controller.signal),
      preparedSource,
      harness.dependencies,
      {
        async beforeProviderRequest() {
          controller.abort();
          return true;
        },
      },
    ),
    { name: "AbortError" },
  );
  assert.equal(
    harness.events.some(
      (event) => event && typeof event === "object" && event.type === "ai:txt2img",
    ),
    false,
  );
});

test("preserves AbortError when cancellation occurs during normalization", async () => {
  const { generate3DViewWithDependencies } = await loadGenerationModule();
  const controller = new AbortController();
  const harness = createHarness({
    async normalizeGeneratedImage(_url, signal) {
      controller.abort();
      signal.throwIfAborted();
    },
  });

  await assert.rejects(
    generate3DViewWithDependencies(
      createRequest(controller.signal),
      preparedSource,
      harness.dependencies,
    ),
    { name: "AbortError" },
  );
});

test("distinguishes output normalization failure after an AI response", async () => {
  const {
    GeneratedImageNormalizationError,
    generate3DViewWithDependencies,
  } = await loadGenerationModule();
  const harness = createHarness({
    async normalizeGeneratedImage() {
      throw new Error("unsupported output");
    },
  });

  await assert.rejects(
    generate3DViewWithDependencies(
      createRequest(),
      preparedSource,
      harness.dependencies,
    ),
    GeneratedImageNormalizationError,
  );
  assert.equal(
    harness.events.filter(
      (event) => event && typeof event === "object" && event.type === "ai:txt2img",
    ).length,
    1,
  );
});
