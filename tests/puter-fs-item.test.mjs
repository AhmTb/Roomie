import assert from "node:assert/strict";
import test from "node:test";

async function loadFsItemCompatibilityModule() {
  return import(new URL("../lib/puter.fs-item.ts", import.meta.url).href);
}

test("recognizes Puter SDK camelCase filesystem item shapes", async () => {
  const { isPuterFsDirectory, isPuterFsFile } =
    await loadFsItemCompatibilityModule();

  assert.equal(isPuterFsDirectory({ isDir: true }), true);
  assert.equal(isPuterFsFile({ isDir: false }), true);
  assert.equal(isPuterFsDirectory({ isDirectory: true }), true);
  assert.equal(isPuterFsFile({ isDirectory: false }), true);
});

test("recognizes raw Puter API snake_case filesystem item shapes", async () => {
  const { isPuterFsDirectory, isPuterFsFile } =
    await loadFsItemCompatibilityModule();

  assert.equal(isPuterFsDirectory({ is_dir: true }), true);
  assert.equal(isPuterFsFile({ is_dir: false }), true);
  assert.equal(isPuterFsDirectory({ fsentry_is_dir: true }), true);
  assert.equal(isPuterFsFile({ fsentry_is_dir: false }), true);
});

test("fails closed for missing, invalid, or conflicting directory flags", async () => {
  const {
    getPuterFsItemDirectoryState,
    isPuterFsDirectory,
    isPuterFsFile,
  } = await loadFsItemCompatibilityModule();

  for (const item of [
    null,
    {},
    { is_dir: 0 },
    { isDir: false, is_dir: true },
  ]) {
    assert.equal(getPuterFsItemDirectoryState(item), null);
    assert.equal(isPuterFsDirectory(item), false);
    assert.equal(isPuterFsFile(item), false);
  }
});

test("creates a nested Puter directory before it is used as a move target", async () => {
  const { ensurePuterFsDirectory } =
    await loadFsItemCompatibilityModule();
  const calls = [];

  const directory = await ensurePuterFsDirectory("root/projects/project-1", {
    async create(path, options) {
      calls.push(["create", path, options]);
      return { path, is_dir: true };
    },
    async read(path) {
      calls.push(["read", path]);
      return null;
    },
  });

  assert.deepEqual(calls, [
    [
      "create",
      "root/projects/project-1",
      { createMissingParents: true },
    ],
  ]);
  assert.deepEqual(directory, {
    path: "root/projects/project-1",
    is_dir: true,
  });
});

test("recovers when another request already created the move target", async () => {
  const { ensurePuterFsDirectory } =
    await loadFsItemCompatibilityModule();
  const creationError = new Error("already exists");

  const directory = await ensurePuterFsDirectory("root/projects/project-2", {
    async create() {
      throw creationError;
    },
    async read(path) {
      return { path, isDir: true };
    },
  });

  assert.deepEqual(directory, {
    path: "root/projects/project-2",
    isDir: true,
  });
});

test("rejects when a move target cannot be proven to be a directory", async () => {
  const { ensurePuterFsDirectory } =
    await loadFsItemCompatibilityModule();
  const creationError = new Error("mkdir failed");

  await assert.rejects(
    ensurePuterFsDirectory("root/projects/project-3", {
      async create() {
        throw creationError;
      },
      async read(path) {
        return { path, is_dir: false };
      },
    }),
    creationError,
  );
});
