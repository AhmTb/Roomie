import assert from "node:assert/strict";
import test from "node:test";

async function loadAttemptModule() {
  return import(new URL("../lib/ai.attempt.ts", import.meta.url).href);
}

function createDependencies() {
  const values = new Map();
  let queue = Promise.resolve();

  return {
    storage: {
      getItem(key) {
        return values.get(key) ?? null;
      },
      setItem(key, value) {
        values.set(key, value);
      },
    },
    locks: {
      async request(_name, operation) {
        const previous = queue;
        let release;
        queue = new Promise((resolve) => {
          release = resolve;
        });
        await previous;
        try {
          return await operation();
        } finally {
          release();
        }
      },
    },
    now: () => 1_700_000_000_000,
  };
}

const request = {
  ownerUserId: "owner-1",
  projectId: "project-1",
  sourceImage: "https://roomie.puter.site/projects/project-1/source.png",
};

test("claims only one automatic attempt for the same project source", async () => {
  const { claimAutomaticGenerationAttemptWithDependencies } =
    await loadAttemptModule();
  const dependencies = createDependencies();

  const [first, second] = await Promise.all([
    claimAutomaticGenerationAttemptWithDependencies(request, dependencies),
    claimAutomaticGenerationAttemptWithDependencies(request, dependencies),
  ]);

  assert.deepEqual([first, second].sort(), [false, true]);
  assert.equal(
    await claimAutomaticGenerationAttemptWithDependencies(
      { ...request, sourceImage: `${request.sourceImage}?replacement=1` },
      dependencies,
    ),
    true,
  );
});

test("fails closed when attempt storage is unavailable", async () => {
  const { claimAutomaticGenerationAttemptWithDependencies } =
    await loadAttemptModule();
  const dependencies = createDependencies();
  dependencies.storage.getItem = () => {
    throw new Error("storage disabled");
  };

  assert.equal(
    await claimAutomaticGenerationAttemptWithDependencies(
      request,
      dependencies,
    ),
    false,
  );
});

test("concurrent different-project claims cannot overwrite each other", async () => {
  const { claimAutomaticGenerationAttemptWithDependencies } =
    await loadAttemptModule();
  const dependencies = createDependencies();
  const secondRequest = {
    ...request,
    projectId: "project-2",
    sourceImage: "https://roomie.puter.site/projects/project-2/source.png",
  };

  assert.deepEqual(
    await Promise.all([
      claimAutomaticGenerationAttemptWithDependencies(request, dependencies),
      claimAutomaticGenerationAttemptWithDependencies(
        secondRequest,
        dependencies,
      ),
    ]),
    [true, true],
  );
  assert.equal(
    await claimAutomaticGenerationAttemptWithDependencies(
      request,
      dependencies,
    ),
    false,
  );
  assert.equal(
    await claimAutomaticGenerationAttemptWithDependencies(
      secondRequest,
      dependencies,
    ),
    false,
  );
});
