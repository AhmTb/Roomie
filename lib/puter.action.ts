import puter from "@heyputer/puter.js";

import { withPuterAccountLock } from "./puter.account";
import {
  getOrCreateHostingConfig,
  uploadImageToHosting,
} from "./puter.hosting";
import { assertSafePathSegment, getHostedUrl } from "./utils";

const MAX_DATE_TIMESTAMP = 8_640_000_000_000_000;

export const signIn = async () =>
  withPuterAccountLock(() => puter.auth.signIn());

export const signOut = async () =>
  withPuterAccountLock(() => puter.auth.signOut());

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
  signal,
}: CreateProjectParams): Promise<DesignItem | null> {
  if (
    !isCreateProjectItem(item) ||
    (visibility !== "private" && visibility !== "public")
  ) {
    console.warn("Failed to create project: invalid project information.");
    return null;
  }

  try {
    const safeProjectId = assertSafePathSegment(item.id, "Project ID");
    signal?.throwIfAborted();
    const hosting = await getOrCreateHostingConfig();
    if (!hosting) return null;

    const hostedSource = await uploadImageToHosting({
      hosting,
      url: item.sourceImage,
      projectId: safeProjectId,
      label: "source",
      signal,
    });
    const sourcePath = hostedSource
      ? getHostedPath(hostedSource.url)
      : null;
    signal?.throwIfAborted();

    if (!hostedSource || !sourcePath) {
      console.warn("Failed to host the source image; project was not created.");
      return null;
    }

    const hostedRender = item.renderedImage
      ? await uploadImageToHosting({
          hosting,
          url: item.renderedImage,
          projectId: safeProjectId,
          label: "rendered",
          signal,
        })
      : null;
    signal?.throwIfAborted();

    if (item.renderedImage && !hostedRender) {
      console.warn("Failed to host the rendered image; project was not created.");
      return null;
    }

    const renderedPath = hostedRender
      ? getHostedPath(hostedRender.url) ?? undefined
      : undefined;

    if (hostedRender && !renderedPath) {
      console.warn("Failed to resolve the rendered image path.");
      return null;
    }

    const publicPath = getHostedUrl(
      hosting.subdomain,
      `projects/${safeProjectId}`,
    );

    if (!publicPath) {
      console.warn("Failed to resolve the hosted project path.");
      return null;
    }

    return {
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
  } catch (error) {
    console.warn("Failed to create Roomie project.", error);
    return null;
  }
}
