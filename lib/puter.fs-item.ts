type PuterFsItemDirectoryShape = {
  isDir?: unknown;
  isDirectory?: unknown;
  is_dir?: unknown;
  fsentry_is_dir?: unknown;
};

type PuterFsDirectoryOperations<T> = {
  create: (
    path: string,
    options: { createMissingParents: true },
  ) => Promise<T>;
  read: (path: string) => Promise<T | null>;
};

const DIRECTORY_FLAG_KEYS = [
  "isDir",
  "isDirectory",
  "is_dir",
  "fsentry_is_dir",
] as const;

export function getPuterFsItemDirectoryState(item: unknown) {
  if (!item || typeof item !== "object") return null;

  const candidate = item as PuterFsItemDirectoryShape;
  let directoryState: boolean | null = null;

  for (const key of DIRECTORY_FLAG_KEYS) {
    const value = candidate[key];
    if (typeof value !== "boolean") continue;
    if (directoryState !== null && directoryState !== value) return null;
    directoryState = value;
  }

  return directoryState;
}

export function isPuterFsDirectory(item: unknown) {
  return getPuterFsItemDirectoryState(item) === true;
}

export function isPuterFsFile(item: unknown) {
  return getPuterFsItemDirectoryState(item) === false;
}

export async function ensurePuterFsDirectory<T>(
  path: string,
  operations: PuterFsDirectoryOperations<T>,
) {
  let creationError: unknown = new Error(
    `Puter did not create the expected directory: ${path}`,
  );

  try {
    const created = await operations.create(path, {
      createMissingParents: true,
    });
    if (isPuterFsDirectory(created)) return created;
  } catch (error) {
    creationError = error;
  }

  const existing = await operations.read(path);
  if (isPuterFsDirectory(existing)) return existing;
  throw creationError;
}
