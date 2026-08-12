import puter from "@heyputer/puter.js";

import {
  finishPuterAccountMutation,
  getPuterAccountVersion,
  hasReliablePuterAccountCoordination,
  startPuterAccountMutation,
  withPuterAccountIntentLock,
  withPuterAccountLock,
} from "./puter.account";
import {
  deleteHostedImage,
  getOrCreateHostingConfig,
  uploadImageToHosting,
} from "./puter.hosting";
import { synchronizeStoredPuterAuth } from "./puter.auth-storage";
import { assertSafePathSegment, getHostedUrl } from "./utils";

const MAX_DATE_TIMESTAMP = 8_640_000_000_000_000;

export function synchronizePuterAuthTokenFromStorage() {
  if (typeof window === "undefined") return false;

  return synchronizeStoredPuterAuth(localStorage, puter, (error) =>
    console.warn("Failed to synchronize the Puter account token.", error),
  );
}

async function mutatePuterAccount(operation: () => Promise<unknown>) {
  return withPuterAccountIntentLock(async () => {
    const version = startPuterAccountMutation();

    try {
      return await withPuterAccountLock(operation);
    } finally {
      finishPuterAccountMutation(version);
    }
  });
}

export const signIn = async () => mutatePuterAccount(() => puter.auth.signIn());

export const signOut = async () =>
  mutatePuterAccount(async () => puter.auth.signOut());

export function getHostedProjectAuthorization(
  expectedOwnerUserId: string,
): HostedProjectAuthorization | null {
  if (!expectedOwnerUserId || !hasReliablePuterAccountCoordination()) {
    return null;
  }
  return {
    expectedOwnerUserId,
    accountVersion: getPuterAccountVersion(),
  };
}

export const getCurrentUser = async () => {
  try {
    return await puter.auth.getUser();
  } catch (error) {
    console.error("Error getting current user:", error);
    return null;
  }
};

function getHostedPath(url: string) {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\/+/, ""));
  } catch {
    return null;
  }
}

function isCreateProjectItem(value: unknown): value is CreateProjectItem {
  if (!value || typeof value !== "object") return false;

  const item = value as Partial<CreateProjectItem>;
  return (
    typeof item.id === "string" &&
    item.id.length > 0 &&
    typeof item.name === "string" &&
    item.name.trim().length > 0 &&
    item.name.trim().length <= 100 &&
    typeof item.sourceImage === "string" &&
    item.sourceImage.length > 0 &&
    (item.renderedImage === undefined ||
      (typeof item.renderedImage === "string" &&
        item.renderedImage.length > 0)) &&
    Number.isFinite(item.timestamp) &&
    item.timestamp! >= 0 &&
    item.timestamp! <= MAX_DATE_TIMESTAMP &&
    typeof item.fileName === "string" &&
    item.fileName.length > 0 &&
    item.fileName.length <= 255 &&
    Number.isSafeInteger(item.fileSize) &&
    item.fileSize! > 0 &&
    (item.mimeType === "image/jpeg" || item.mimeType === "image/png")
  );
}

export async function createProject({
  item,
  visibility,
  expectedOwnerUserId,
  authorization,
  signal,
  commit,
}: CreateProjectParams): Promise<DesignItem | null> {
  if (
    !isCreateProjectItem(item) ||
    (visibility !== "private" && visibility !== "public") ||
    typeof expectedOwnerUserId !== "string" ||
    !expectedOwnerUserId.trim() ||
    !authorization ||
    typeof authorization !== "object" ||
    authorization.expectedOwnerUserId !== expectedOwnerUserId ||
    typeof authorization.accountVersion !== "string" ||
    !authorization.accountVersion ||
    typeof commit !== "function"
  ) {
    console.warn("Failed to create project: invalid project information.");
    return null;
  }

  if (!hasReliablePuterAccountCoordination()) {
    console.warn(
      "Failed to create project: this browser cannot safely coordinate Puter account changes across tabs.",
    );
    return null;
  }

  const safeProjectId = (() => {
    try {
      return assertSafePathSegment(item.id, "Project ID");
    } catch (error) {
      console.warn("Failed to create Roomie project.", error);
      return null;
    }
  })();
  if (!safeProjectId) return null;
  const authorizedAccountVersion = authorization.accountVersion;

  return withPuterAccountIntentLock(() =>
    withPuterAccountLock(async (accountLease) => {
      let activeHosting: HostingConfig | null = null;
      let undoCommit: (() => void) | null = null;
      const writtenAssets: HostedAsset[] = [];

      const trackWrittenAsset = (asset: HostedAsset | null) => {
        if (asset?.wasWritten) {
          writtenAssets.push(asset);
        }
        return asset;
      };

      const rollBackWrites = async () => {
        if (!activeHosting) return;

        for (const asset of [...writtenAssets].reverse()) {
          await deleteHostedImage(
            { hosting: activeHosting, asset },
            accountLease,
          );
        }
      };

      try {
      signal?.throwIfAborted();
      if (getPuterAccountVersion() !== authorizedAccountVersion) {
        throw new Error("The Puter account changed before upload.");
      }
      const currentUser = await puter.auth.getUser();
      if (currentUser?.uuid !== expectedOwnerUserId) {
        throw new Error("The signed-in Puter account changed before upload.");
      }
      signal?.throwIfAborted();

      const hosting = await getOrCreateHostingConfig(
        expectedOwnerUserId,
        accountLease,
      );
      if (!hosting || hosting.ownerUserId !== expectedOwnerUserId) {
        throw new Error("Roomie hosting is unavailable for this account.");
      }
      activeHosting = hosting;
      signal?.throwIfAborted();

      const hostedSource = trackWrittenAsset(
        await uploadImageToHosting(
          {
            hosting,
            url: item.sourceImage,
            projectId: safeProjectId,
            label: "source",
            signal,
          },
          accountLease,
        ),
      );
      const sourcePath = hostedSource
        ? getHostedPath(hostedSource.url)
        : null;
      signal?.throwIfAborted();

      if (!hostedSource || !sourcePath) {
        throw new Error("Failed to host the source image.");
      }

      const hostedRender = item.renderedImage
        ? trackWrittenAsset(
            await uploadImageToHosting(
              {
                hosting,
                url: item.renderedImage,
                projectId: safeProjectId,
                label: "rendered",
                signal,
              },
              accountLease,
            ),
          )
        : null;
      signal?.throwIfAborted();

      if (item.renderedImage && !hostedRender) {
        throw new Error("Failed to host the rendered image.");
      }

      const renderedPath = hostedRender
        ? getHostedPath(hostedRender.url) ?? undefined
        : undefined;
      if (hostedRender && !renderedPath) {
        throw new Error("Failed to resolve the rendered image path.");
      }

      const publicPath = getHostedUrl(
        hosting.subdomain,
        `projects/${safeProjectId}`,
      );
      if (!publicPath) {
        throw new Error("Failed to resolve the hosted project path.");
      }

      signal?.throwIfAborted();
      if (getPuterAccountVersion() !== authorizedAccountVersion) {
        throw new Error("The Puter account changed during upload.");
      }
      const confirmedUser = await puter.auth.getUser();
      if (confirmedUser?.uuid !== expectedOwnerUserId) {
        throw new Error("The signed-in Puter account changed during upload.");
      }
      signal?.throwIfAborted();
      const payload: DesignItem = {
        id: safeProjectId,
        name: item.name.trim(),
        sourceImage: hostedSource.url,
        renderedImage: hostedRender?.url,
        timestamp: item.timestamp,
        ownerId: hosting.ownerUserId,
        visibility,
        assetAccess: "public-hosted",
        sourcePath,
        renderedPath,
        publicPath,
        fileName: item.fileName,
        fileSize: item.fileSize,
        mimeType: item.mimeType,
      };
      // Keep both account locks until React Router confirms the owner-bound
      // browser handoff. If a later step fails, undo local state before the
      // public files are removed.
      undoCommit = await commit(payload);
      return payload;
      } catch (error) {
        if (undoCommit) {
          try {
            undoCommit();
          } catch (undoError) {
            console.warn(
              "Failed to roll back incomplete Roomie project state.",
              undoError,
            );
          }
        }
        await rollBackWrites();
        console.warn("Failed to create Roomie project.", error);
        return null;
      }
    }),
  );
}
