import puter from "@heyputer/puter.js";

import {
  hasPuterAccountLease,
  withPuterAccountLock,
} from "./puter.account";
import type { PuterAccountLease } from "./puter.account";
import {
  ensurePuterFsDirectory,
  isPuterFsDirectory,
  isPuterFsFile,
} from "./puter.fs-item";
import {
  HOSTING_CONFIG_KEY,
  HOSTING_ROOT_DIRECTORY,
  assertSafePathSegment,
  createHostingSlug,
  fetchBlobFromUrl,
  getHostedUrl,
  imageUrlToPngBlob,
  isHostedUrl,
  isValidHostingSubdomain,
  verifyImageBlob,
} from "./utils";

const hostingConfigRequests = new Map<
  string,
  Promise<HostingConfig | null>
>();
const HOSTING_CONFIG_LOCK_PREFIX = "roomie-hosting-config";
const HOSTING_STAGING_DIRECTORY = "roomie-upload-staging";

function createStagingFileName(extension: "jpg" | "png") {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Secure random values are unavailable in this browser.");
  }

  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const token = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${token}.${extension}`;
}

function isHostingConfig(
  value: unknown,
  ownerUserId: string,
): value is HostingConfig {
  if (!value || typeof value !== "object") return false;

  const config = value as Partial<HostingConfig>;
  return (
    config.version === 1 &&
    config.ownerUserId === ownerUserId &&
    typeof config.subdomain === "string" &&
    isValidHostingSubdomain(config.subdomain) &&
    config.rootDirectory === HOSTING_ROOT_DIRECTORY &&
    typeof config.rootDirectoryUid === "string" &&
    config.rootDirectoryUid.length > 0
  );
}

async function getCurrentOwnerUserId() {
  try {
    const user = await puter.auth.getUser();
    return user?.uuid || null;
  } catch {
    return null;
  }
}

async function assertCurrentOwner(ownerUserId: string) {
  const currentOwnerUserId = await getCurrentOwnerUserId();
  if (currentOwnerUserId !== ownerUserId) {
    throw new Error("The signed-in Puter account changed during hosting setup.");
  }
}

async function getStrongFsItem(filePath: string, ownerUserId: string) {
  await assertCurrentOwner(ownerUserId);

  try {
    const item = await puter.fs.stat(filePath, {
      consistency: "strong",
      returnSize: true,
    });
    await assertCurrentOwner(ownerUserId);
    return item;
  } catch {
    // Do not turn an account transition into a missing-file result.
    await assertCurrentOwner(ownerUserId);
    return null;
  }
}

async function getStrongFsItemByUid(uid: string, ownerUserId: string) {
  await assertCurrentOwner(ownerUserId);

  try {
    const item = await puter.fs.stat({
      uid,
      consistency: "strong",
      returnSize: true,
    });
    await assertCurrentOwner(ownerUserId);
    return item;
  } catch {
    await assertCurrentOwner(ownerUserId);
    return null;
  }
}

function getAppRelativeFsPath(filePath: string) {
  const normalizedPath = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const appDataMatch = normalizedPath.match(
    /(?:^|\/)AppData\/[^/]+\/(.+)$/,
  );
  return appDataMatch?.[1] ?? normalizedPath;
}

function fsItemHasPath(itemPath: string, expectedPath: string) {
  return getAppRelativeFsPath(itemPath) === expectedPath;
}

async function recoverPublishedStagedItem(
  filePath: string,
  stagedUid: string,
  ownerUserId: string,
) {
  // Prefer a path lookup because it also detects a collision at the intended
  // destination. Fall back to the immutable UID when a committed move's
  // response or the path lookup was lost to a transient network failure.
  const itemAtFinalPath = await getStrongFsItem(filePath, ownerUserId);
  if (
    itemAtFinalPath?.uid === stagedUid &&
    isPuterFsFile(itemAtFinalPath) &&
    fsItemHasPath(itemAtFinalPath.path, filePath)
  ) {
    return itemAtFinalPath;
  }

  const stagedItemByUid = await getStrongFsItemByUid(
    stagedUid,
    ownerUserId,
  );
  return stagedItemByUid?.uid === stagedUid &&
    isPuterFsFile(stagedItemByUid) &&
    fsItemHasPath(stagedItemByUid.path, filePath)
    ? stagedItemByUid
    : null;
}

async function blobsHaveEqualBytes(left: Blob, right: Blob) {
  if (left.size !== right.size) return false;

  const [leftBytes, rightBytes] = await Promise.all([
    left.arrayBuffer().then((buffer) => new Uint8Array(buffer)),
    right.arrayBuffer().then((buffer) => new Uint8Array(buffer)),
  ]);

  for (let index = 0; index < leftBytes.length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return false;
  }

  return true;
}

async function recoverMatchingStagedItem(
  filePath: string,
  expectedBlob: Blob,
  ownerUserId: string,
) {
  const beforeRead = await getStrongFsItem(filePath, ownerUserId);
  if (
    !beforeRead?.uid ||
    !isPuterFsFile(beforeRead) ||
    (beforeRead.size !== null && beforeRead.size !== expectedBlob.size)
  ) {
    return null;
  }

  let storedBlob: Blob;
  try {
    await assertCurrentOwner(ownerUserId);
    storedBlob = await puter.fs.read(filePath);
    await assertCurrentOwner(ownerUserId);
  } catch {
    await assertCurrentOwner(ownerUserId);
    return null;
  }

  if (!(await blobsHaveEqualBytes(storedBlob, expectedBlob))) return null;

  // Ensure the path was not replaced while its bytes were being checked.
  const afterRead = await getStrongFsItem(filePath, ownerUserId);
  return afterRead?.uid === beforeRead.uid && isPuterFsFile(afterRead)
    ? afterRead
    : null;
}

async function quarantineConfirmedStagedItem(
  filePath: string,
  uid: string,
  ownerUserId: string,
) {
  const item = await getStrongFsItemByUid(uid, ownerUserId);
  if (!item) return false;
  if (
    item.uid !== uid ||
    !isPuterFsFile(item) ||
    !fsItemHasPath(item.path, filePath)
  ) {
    return false;
  }
  // Puter 2.6.0 exposes UID-addressed rename but only path-addressed delete.
  // Renaming by UID makes any uncertain object unreachable at its old path
  // without risking deletion of a replacement that raced into that path.
  const quarantinedName = `abandoned-${createStagingFileName(
    filePath.endsWith(".png") ? "png" : "jpg",
  )}`;
  await puter.fs.rename({ uid, newName: quarantinedName });
  return true;
}

type FailedPublicationReconciliation =
  | "published"
  | "quarantined"
  | "unknown";

async function reconcileFailedPublication(
  stagingPath: string,
  finalPath: string,
  ownerUserId: string,
  expectedUid: string | null,
  expectedBlob: Blob,
): Promise<FailedPublicationReconciliation> {
  if (expectedUid) {
    const candidate = await getStrongFsItemByUid(expectedUid, ownerUserId);
    if (
      !candidate?.uid ||
      !isPuterFsFile(candidate) ||
      candidate.uid !== expectedUid
    ) {
      return "unknown";
    }

    // A late UID lookup can be the first successful observation after an
    // ambiguous move. Convert that confirmation into a tracked success.
    if (fsItemHasPath(candidate.path, finalPath)) {
      return "published";
    }
    if (!fsItemHasPath(candidate.path, stagingPath)) {
      return "unknown";
    }

    return (await quarantineConfirmedStagedItem(
      stagingPath,
      candidate.uid,
      ownerUserId,
    ))
      ? "quarantined"
      : "unknown";
  }

  const candidate = await recoverMatchingStagedItem(
    stagingPath,
    expectedBlob,
    ownerUserId,
  );
  if (!candidate?.uid || !isPuterFsFile(candidate)) {
    return "unknown";
  }

  await assertCurrentOwner(ownerUserId);
  let wasQuarantined: boolean;
  try {
    wasQuarantined = await quarantineConfirmedStagedItem(
      stagingPath,
      candidate.uid,
      ownerUserId,
    );
  } catch {
    await assertCurrentOwner(ownerUserId);
    return "unknown";
  }
  await assertCurrentOwner(ownerUserId);
  return wasQuarantined ? "quarantined" : "unknown";
}

async function ensureHostingRootDirectory() {
  const rootItems = await puter.fs.readdir(".");
  const existing = rootItems.find(
    (item) => item.name === HOSTING_ROOT_DIRECTORY,
  );

  if (existing) {
    if (!isPuterFsDirectory(existing)) {
      throw new Error("The Roomie hosting path is not a directory.");
    }
    return existing;
  }

  try {
    return await puter.fs.mkdir(HOSTING_ROOT_DIRECTORY, {
      createMissingParents: true,
    });
  } catch (initialError) {
    const racedDirectory = await puter.fs.stat(HOSTING_ROOT_DIRECTORY);
    if (!isPuterFsDirectory(racedDirectory)) throw initialError;
    return racedDirectory;
  }
}

async function ensureHostedAssetDirectory(
  directoryPath: string,
  ownerUserId: string,
) {
  return ensurePuterFsDirectory(directoryPath, {
    create: async (path, options) => {
      await assertCurrentOwner(ownerUserId);
      const directory = await puter.fs.mkdir(path, options);
      await assertCurrentOwner(ownerUserId);
      return directory;
    },
    read: (path) => getStrongFsItem(path, ownerUserId),
  });
}

async function readExistingHostingConfig(ownerUserId: string) {
  const existing = await puter.kv.get<unknown>(HOSTING_CONFIG_KEY);
  if (existing === undefined) return null;

  if (!isHostingConfig(existing, ownerUserId)) {
    console.warn("Replacing an invalid Roomie hosting configuration.");
    return null;
  }

  await assertCurrentOwner(ownerUserId);
  const rootDirectory = await ensureHostingRootDirectory();
  await assertCurrentOwner(ownerUserId);
  const deployments = await puter.hosting.list();
  await assertCurrentOwner(ownerUserId);
  const deployment = deployments.find(
    (candidate) => candidate.subdomain === existing.subdomain,
  );

  if (!deployment) {
    return null;
  }

  if (deployment.root_dir.uid !== rootDirectory.uid) {
    console.warn(
      "Replacing a Roomie hosting deployment with a changed root directory.",
    );
    return null;
  }

  if (existing.rootDirectoryUid !== rootDirectory.uid) {
    const repaired: HostingConfig = {
      ...existing,
      rootDirectoryUid: rootDirectory.uid,
    };
    await assertCurrentOwner(ownerUserId);
    await puter.kv.set(HOSTING_CONFIG_KEY, repaired);
    await assertCurrentOwner(ownerUserId);
    return repaired;
  }

  return existing;
}

async function createHostingConfig(ownerUserId: string) {
  const rootDirectory = await ensureHostingRootDirectory();
  await assertCurrentOwner(ownerUserId);

  const created = await puter.hosting.create(
    createHostingSlug(),
    HOSTING_ROOT_DIRECTORY,
  );
  const record: HostingConfig = {
    version: 1,
    ownerUserId,
    subdomain: created.subdomain,
    rootDirectory: HOSTING_ROOT_DIRECTORY,
    rootDirectoryUid: created.root_dir.uid || rootDirectory.uid,
  };

  try {
    await assertCurrentOwner(ownerUserId);
    await puter.kv.set(HOSTING_CONFIG_KEY, record);
  } catch (error) {
    try {
      await puter.hosting.delete(created.subdomain);
    } catch (cleanupError) {
      console.warn(
        "Failed to clean up an untracked Roomie hosting deployment.",
        cleanupError,
      );
    }
    throw error;
  }

  await assertCurrentOwner(ownerUserId);
  return record;
}

async function resolveHostingConfig(ownerUserId: string) {
  const existing = await readExistingHostingConfig(ownerUserId);
  return existing ?? createHostingConfig(ownerUserId);
}

async function resolveHostingConfigWithLock(ownerUserId: string) {
  const resolveForCurrentAccount = () =>
    withPuterAccountLock(async () => {
      await assertCurrentOwner(ownerUserId);
      return resolveHostingConfig(ownerUserId);
    });

  if (typeof navigator === "undefined" || !navigator.locks) {
    return resolveForCurrentAccount();
  }

  return navigator.locks.request(
    `${HOSTING_CONFIG_LOCK_PREFIX}:${ownerUserId}`,
    resolveForCurrentAccount,
  );
}

export async function getOrCreateHostingConfig(
  expectedOwnerUserId?: string,
  accountLease?: PuterAccountLease,
): Promise<HostingConfig | null> {
  const ownerUserId = await getCurrentOwnerUserId();
  if (
    !ownerUserId ||
    (expectedOwnerUserId && ownerUserId !== expectedOwnerUserId)
  ) {
    return null;
  }

  if (hasPuterAccountLease(accountLease)) {
    try {
      return await resolveHostingConfig(ownerUserId);
    } catch (error) {
      console.warn("Failed to get or create Roomie hosting.", error);
      return null;
    }
  }

  const activeRequest = hostingConfigRequests.get(ownerUserId);
  if (activeRequest) return activeRequest;

  const request = resolveHostingConfigWithLock(ownerUserId)
    .catch((error) => {
      console.warn("Failed to get or create Roomie hosting.", error);
      return null;
    })
    .finally(() => {
      hostingConfigRequests.delete(ownerUserId);
    });

  hostingConfigRequests.set(ownerUserId, request);
  return request;
}

export async function uploadImageToHosting(
  { hosting, url, projectId, label, signal }: StoreHostedImageParams,
  accountLease?: PuterAccountLease,
): Promise<HostedAsset | null> {
  if (!hosting || !url) return null;

  try {
    if (!isHostingConfig(hosting, hosting.ownerUserId)) {
      throw new Error("The Roomie hosting configuration is invalid.");
    }
    if (label !== "source" && label !== "rendered") {
      throw new Error("The hosted image label is invalid.");
    }

    const safeProjectId = assertSafePathSegment(projectId, "Project ID");
    const safeLabel = assertSafePathSegment(label, "Image label");
    if (isHostedUrl(url, hosting.subdomain)) {
      const acceptHostedAsset = async () => {
        await assertCurrentOwner(hosting.ownerUserId);
        const parsedUrl = new URL(url);
        const expectedPath = new RegExp(
          `^/projects/${encodeURIComponent(safeProjectId)}/${safeLabel}\\.(?:jpg|png)$`,
        );
        if (
          !expectedPath.test(parsedUrl.pathname) ||
          parsedUrl.search ||
          parsedUrl.hash
        ) {
          throw new Error("The hosted image does not match this project asset.");
        }
        return { url: parsedUrl.toString(), wasWritten: false };
      };

      return hasPuterAccountLease(accountLease)
        ? await acceptHostedAsset()
        : await withPuterAccountLock(acceptHostedAsset);
    }

    const resolvedBlob =
      label === "rendered"
        ? await imageUrlToPngBlob(url, signal)
        : (await fetchBlobFromUrl(url, signal)).blob;
    const verified = await verifyImageBlob(resolvedBlob);
    const publicPath = `projects/${safeProjectId}/${safeLabel}.${verified.extension}`;
    const filePath = `${hosting.rootDirectory}/${publicPath}`;
    const finalDirectory = `${hosting.rootDirectory}/projects/${safeProjectId}`;
    const finalFileName = `${safeLabel}.${verified.extension}`;
    const hostedUrl = getHostedUrl(hosting.subdomain, publicPath);
    const stagingPath = `${HOSTING_STAGING_DIRECTORY}/${createStagingFileName(
      verified.extension,
    )}`;
    if (!hostedUrl) {
      throw new Error("The hosted image URL could not be resolved.");
    }

    signal?.throwIfAborted();
    const writeHostedAsset = async () => {
      await assertCurrentOwner(hosting.ownerUserId);
      signal?.throwIfAborted();
      let stagedUid: string | null = null;
      let stagingWriteAttempted = false;

      try {
        try {
          stagingWriteAttempted = true;
          const stagedItem = await puter.fs.write(
            stagingPath,
            verified.blob,
            {
              createMissingParents: true,
              dedupeName: false,
              overwrite: false,
            },
          );
          if (!stagedItem.uid || !isPuterFsFile(stagedItem)) {
            throw new Error("The staged Roomie image is invalid.");
          }
          stagedUid = stagedItem.uid;

          const confirmedStage = await getStrongFsItem(
            stagingPath,
            hosting.ownerUserId,
          );
          if (
            confirmedStage?.uid !== stagedUid ||
            !isPuterFsFile(confirmedStage)
          ) {
            throw new Error("The staged Roomie image could not be confirmed.");
          }
        } catch (writeError) {
          // A request can reject after Puter persisted the file. Recover only
          // when strong reads prove that this unguessable staging path holds
          // the exact bytes we attempted to write.
          const recoveredStage = await recoverMatchingStagedItem(
            stagingPath,
            verified.blob,
            hosting.ownerUserId,
          );
          if (
            !recoveredStage?.uid ||
            (stagedUid && recoveredStage.uid !== stagedUid)
          ) {
            throw writeError;
          }
          stagedUid = recoveredStage.uid;
        }

        signal?.throwIfAborted();
        // Puter's live move endpoint requires its destination directory to
        // exist even when createMissingParents is requested. Create it first;
        // the recovery read also makes concurrent directory creation safe.
        await ensureHostedAssetDirectory(
          finalDirectory,
          hosting.ownerUserId,
        );
        signal?.throwIfAborted();
        try {
          // Passing the parent and new name explicitly avoids Puter's
          // destination-path heuristic and keeps collision handling atomic.
          const movedItem = await puter.fs.move(
            stagingPath,
            finalDirectory,
            {
              createMissingParents: true,
              newName: finalFileName,
              overwrite: false,
            },
          );
          if (
            movedItem.uid !== stagedUid ||
            !isPuterFsFile(movedItem) ||
            !fsItemHasPath(movedItem.path, filePath)
          ) {
            throw new Error("The published Roomie image is invalid.");
          }
        } catch (moveError) {
          // If the move committed but its response was lost, the immutable UID
          // proves that the final object is the staged object from this upload.
          const recoveredFinal = await recoverPublishedStagedItem(
            filePath,
            stagedUid,
            hosting.ownerUserId,
          );
          if (
            !recoveredFinal?.uid ||
            recoveredFinal.uid !== stagedUid ||
            !isPuterFsFile(recoveredFinal)
          ) {
            throw moveError;
          }
        }

        return { url: hostedUrl, filePath, wasWritten: true };
      } catch (publicationError) {
        if (stagingWriteAttempted) {
          try {
            const reconciliation = await reconcileFailedPublication(
              stagingPath,
              filePath,
              hosting.ownerUserId,
              stagedUid,
              verified.blob,
            );
            if (reconciliation === "published") {
              return { url: hostedUrl, filePath, wasWritten: true };
            }
          } catch (cleanupError) {
            console.warn(
              "Failed to reconcile a staged Roomie image.",
              cleanupError,
            );
          }
        }
        throw publicationError;
      }
    };

    return hasPuterAccountLease(accountLease)
      ? await writeHostedAsset()
      : await withPuterAccountLock(writeHostedAsset);
  } catch (error) {
    console.warn("Failed to store the hosted Roomie image.", error);
    return null;
  }
}

export async function deleteHostedImage(
  { hosting, asset }: DeleteHostedImageParams,
  accountLease?: PuterAccountLease,
) {
  if (!asset.wasWritten || !asset.filePath) return true;
  if (!isHostingConfig(hosting, hosting.ownerUserId)) return false;

  const pathSegments = asset.filePath.split("/");
  const [rootDirectory, projectsDirectory, projectId, fileName] = pathSegments;
  if (
    pathSegments.length !== 4 ||
    pathSegments.some((segment) => segment === "." || segment === "..") ||
    rootDirectory !== hosting.rootDirectory ||
    projectsDirectory !== "projects" ||
    !/^(?:source|rendered)\.(?:jpg|png)$/.test(fileName)
  ) {
    return false;
  }

  try {
    assertSafePathSegment(projectId, "Project ID");
  } catch {
    return false;
  }

  const deleteAsset = async () => {
    await assertCurrentOwner(hosting.ownerUserId);
    await puter.fs.delete(asset.filePath!);
    await assertCurrentOwner(hosting.ownerUserId);
    return true;
  };

  try {
    return hasPuterAccountLease(accountLease)
      ? await deleteAsset()
      : await withPuterAccountLock(deleteAsset);
  } catch (error) {
    console.warn(
      "Failed to clean up an incomplete Roomie project asset.",
      error,
    );
    return false;
  }
}
