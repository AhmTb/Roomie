import puter from "@heyputer/puter.js";

import { withPuterAccountLock } from "./puter.action";
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

async function ensureHostingRootDirectory() {
  const rootItems = await puter.fs.readdir(".");
  const existing = rootItems.find(
    (item) => item.name === HOSTING_ROOT_DIRECTORY,
  );

  if (existing) {
    if (!existing.isDir) {
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
    if (!racedDirectory.isDir) throw initialError;
    return racedDirectory;
  }
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
    await assertCurrentOwner(ownerUserId);
    return record;
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

export async function getOrCreateHostingConfig(): Promise<HostingConfig | null> {
  const ownerUserId = await getCurrentOwnerUserId();
  if (!ownerUserId) return null;

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

export async function uploadImageToHosting({
  hosting,
  url,
  projectId,
  label,
  signal,
}: StoreHostedImageParams): Promise<HostedAsset | null> {
  if (!hosting || !url) return null;

  try {
    if (!isHostingConfig(hosting, hosting.ownerUserId)) {
      throw new Error("The Roomie hosting configuration is invalid.");
    }
    if (label !== "original" && label !== "rendered") {
      throw new Error("The hosted image label is invalid.");
    }

    const safeProjectId = assertSafePathSegment(projectId, "Project ID");
    const safeLabel = assertSafePathSegment(label, "Image label");
    if (isHostedUrl(url, hosting.subdomain)) {
      return withPuterAccountLock(async () => {
        await assertCurrentOwner(hosting.ownerUserId);
        return { url: new URL(url).toString() };
      });
    }

    const resolvedBlob =
      label === "rendered"
        ? await imageUrlToPngBlob(url, signal)
        : (await fetchBlobFromUrl(url, signal)).blob;
    const verified = await verifyImageBlob(resolvedBlob);
    const publicPath = `projects/${safeProjectId}/${safeLabel}.${verified.extension}`;
    const filePath = `${hosting.rootDirectory}/${publicPath}`;

    signal?.throwIfAborted();
    return await withPuterAccountLock(async () => {
      await assertCurrentOwner(hosting.ownerUserId);
      signal?.throwIfAborted();
      await puter.fs.write(filePath, verified.blob, {
        createMissingParents: true,
        dedupeName: false,
        overwrite: true,
      });
      await assertCurrentOwner(hosting.ownerUserId);

      const hostedUrl = getHostedUrl(hosting.subdomain, publicPath);
      return hostedUrl ? { url: hostedUrl } : null;
    });
  } catch (error) {
    console.warn("Failed to store the hosted Roomie image.", error);
    return null;
  }
}
