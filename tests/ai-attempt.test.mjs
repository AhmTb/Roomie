import assert from "node:assert/strict";
import test from "node:test";

async function loadAttemptModule() {
  return import(new URL("../lib/ai.attempt.ts", import.meta.url).href);
}

function createDependencies() {
  const values = new Map();
  let queue = Promise.resolve();
  let now = 1_700_000_000_000;
  let nextClaimId = 0;

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
    now: () => now,
    createClaimId: () => `claim-${++nextClaimId}`,
    setNow(value) {
      now = value;
    },
    setStored(value) {
      values.set("roomie:ai-generation-attempts:v1", value);
    },
    getStored() {
      return values.get("roomie:ai-generation-attempts:v1") ?? null;
    },
  };
}

const request = {
  ownerUserId: "owner-1",
  projectId: "project-1",
  sourceImage: "https://roomie.puter.site/projects/project-1/source.png",
};

test("reserves only one automatic attempt for the same project source", async () => {
  const { claimAutomaticGenerationAttemptWithDependencies } =
    await loadAttemptModule();
  const dependencies = createDependencies();

  const claims = await Promise.all([
    claimAutomaticGenerationAttemptWithDependencies(request, dependencies),
    claimAutomaticGenerationAttemptWithDependencies(request, dependencies),
  ]);

  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(claims.filter((claim) => claim === null).length, 1);
});

test("release before provider dispatch allows a later automatic claim", async () => {
  const {
    claimAutomaticGenerationAttemptWithDependencies,
    releaseAutomaticGenerationAttemptWithDependencies,
  } = await loadAttemptModule();
  const dependencies = createDependencies();
  const firstLease = await claimAutomaticGenerationAttemptWithDependencies(
    request,
    dependencies,
  );

  assert.ok(firstLease);
  assert.equal(
    await releaseAutomaticGenerationAttemptWithDependencies(
      firstLease,
      dependencies,
    ),
    true,
  );
  assert.ok(
    await claimAutomaticGenerationAttemptWithDependencies(
      request,
      dependencies,
    ),
  );
});

test("a started attempt is permanent and cannot be released", async () => {
  const {
    claimAutomaticGenerationAttemptWithDependencies,
    commitAutomaticGenerationAttemptWithDependencies,
    releaseAutomaticGenerationAttemptWithDependencies,
  } = await loadAttemptModule();
  const dependencies = createDependencies();
  const lease = await claimAutomaticGenerationAttemptWithDependencies(
    request,
    dependencies,
  );

  assert.ok(lease);
  assert.equal(
    await commitAutomaticGenerationAttemptWithDependencies(
      lease,
      dependencies,
    ),
    true,
  );
  assert.equal(
    await releaseAutomaticGenerationAttemptWithDependencies(
      lease,
      dependencies,
    ),
    false,
  );
  assert.equal(
    await claimAutomaticGenerationAttemptWithDependencies(
      request,
      dependencies,
    ),
    null,
  );
});

test("an expired reservation can be replaced but its stale token cannot commit", async () => {
  const {
    claimAutomaticGenerationAttemptWithDependencies,
    commitAutomaticGenerationAttemptWithDependencies,
    releaseAutomaticGenerationAttemptWithDependencies,
  } = await loadAttemptModule();
  const dependencies = createDependencies();
  const staleLease = await claimAutomaticGenerationAttemptWithDependencies(
    request,
    dependencies,
  );
  dependencies.setNow(1_700_000_360_000);
  const replacementLease = await claimAutomaticGenerationAttemptWithDependencies(
    request,
    dependencies,
  );

  assert.ok(staleLease);
  assert.ok(replacementLease);
  assert.notEqual(staleLease.claimId, replacementLease.claimId);
  assert.equal(
    await commitAutomaticGenerationAttemptWithDependencies(
      staleLease,
      dependencies,
    ),
    false,
  );
  assert.equal(
    await releaseAutomaticGenerationAttemptWithDependencies(
      staleLease,
      dependencies,
    ),
    false,
  );
  assert.equal(
    await commitAutomaticGenerationAttemptWithDependencies(
      replacementLease,
      dependencies,
    ),
    true,
  );
});

test("corrupt storage is repaired while the current source fails closed", async () => {
  const { claimAutomaticGenerationAttemptWithDependencies } =
    await loadAttemptModule();
  const dependencies = createDependencies();
  dependencies.setStored("{not-json");

  assert.equal(
    await claimAutomaticGenerationAttemptWithDependencies(
      request,
      dependencies,
    ),
    null,
  );
  const repaired = JSON.parse(dependencies.getStored());
  assert.equal(repaired[0].phase, "started");
  assert.equal(repaired[0].projectId, request.projectId);

  assert.ok(
    await claimAutomaticGenerationAttemptWithDependencies(
      {
        ...request,
        projectId: "project-2",
        sourceImage: "https://roomie.puter.site/projects/project-2/source.png",
      },
      dependencies,
    ),
  );
});

test("corruption repair preserves other valid started attempts", async () => {
  const { claimAutomaticGenerationAttemptWithDependencies } =
    await loadAttemptModule();
  const dependencies = createDependencies();
  const protectedRequest = {
    ...request,
    projectId: "protected-project",
    sourceImage: "https://roomie.puter.site/projects/protected/source.png",
  };
  dependencies.setStored(
    JSON.stringify([
      {
        ...protectedRequest,
        phase: "started",
        claimId: "protected-claim",
        updatedAt: 1_700_000_000_000,
      },
      { invalid: true },
    ]),
  );

  assert.equal(
    await claimAutomaticGenerationAttemptWithDependencies(
      request,
      dependencies,
    ),
    null,
  );
  assert.equal(
    await claimAutomaticGenerationAttemptWithDependencies(
      protectedRequest,
      dependencies,
    ),
    null,
  );
  const repaired = JSON.parse(dependencies.getStored());
  const preserved = repaired.find(
    (attempt) => attempt.projectId === protectedRequest.projectId,
  );
  assert.equal(preserved.claimId, "protected-claim");
  assert.equal(preserved.updatedAt, 1_700_000_000_000);
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
    null,
  );
});

test("fails closed when the attempt lock rejects", async () => {
  const { claimAutomaticGenerationAttemptWithDependencies } =
    await loadAttemptModule();
  const dependencies = createDependencies();
  dependencies.locks.request = async () => {
    throw new Error("locks disabled");
  };

  assert.equal(
    await claimAutomaticGenerationAttemptWithDependencies(
      request,
      dependencies,
    ),
    null,
  );
});

test("concurrent different-project reservations cannot overwrite each other", async () => {
  const { claimAutomaticGenerationAttemptWithDependencies } =
    await loadAttemptModule();
  const dependencies = createDependencies();
  const secondRequest = {
    ...request,
    projectId: "project-2",
    sourceImage: "https://roomie.puter.site/projects/project-2/source.png",
  };

  const claims = await Promise.all([
    claimAutomaticGenerationAttemptWithDependencies(request, dependencies),
    claimAutomaticGenerationAttemptWithDependencies(secondRequest, dependencies),
  ]);
  assert.ok(claims[0]);
  assert.ok(claims[1]);
  assert.equal(
    await claimAutomaticGenerationAttemptWithDependencies(
      request,
      dependencies,
    ),
    null,
  );
  assert.equal(
    await claimAutomaticGenerationAttemptWithDependencies(
      secondRequest,
      dependencies,
    ),
    null,
  );
});
