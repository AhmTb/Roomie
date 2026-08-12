export const MAX_FLOOR_PLAN_SIZE_BYTES = 10 * 1024 * 1024;

export const ACCEPTED_FLOOR_PLAN_TYPES = [
  "image/jpeg",
  "image/png",
] as const;

export const FLOOR_PLAN_ACCEPT_ATTRIBUTE = ".jpg,.jpeg,.png";

const MAX_ACTIVE_UPLOAD_SESSIONS = 20;
const MAX_FLOOR_PLAN_PIXEL_COUNT = 40_000_000;
const MAX_DATE_TIMESTAMP = 8_640_000_000_000_000;
const SAFE_PROJECT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const PUTER_HOST =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.puter\.site$/;

export interface FloorPlanUploadSession {
  id: string;
  ownerUserId: string;
  project: DesignItem;
  fileName: string;
  fileSize: number;
  mimeType: string;
  createdAt: number;
}

const uploadSessions = new Map<string, FloorPlanUploadSession>();

type FloorPlanFileMetadata = Pick<File, "name" | "size" | "type">;

export function validateFloorPlanFile(file: FloorPlanFileMetadata) {
  if (file.size === 0) {
    return "This file is empty. Choose a JPG or PNG floor plan.";
  }

  if (
    !ACCEPTED_FLOOR_PLAN_TYPES.includes(
      file.type.toLowerCase() as (typeof ACCEPTED_FLOOR_PLAN_TYPES)[number],
    )
  ) {
    return "Choose a JPG or PNG image.";
  }

  if (file.size > MAX_FLOOR_PLAN_SIZE_BYTES) {
    return "This file is larger than 10 MB. Choose a smaller floor plan.";
  }

  return null;
}

function hasJpegSignature(bytes: Uint8Array) {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function hasPngSignature(bytes: Uint8Array) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  return signature.every((byte, index) => bytes[index] === byte);
}

async function readImageDimensions(file: File) {
  if (typeof globalThis.createImageBitmap === "function") {
    const bitmap = await globalThis.createImageBitmap(file);

    try {
      return { width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close();
    }
  }

  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    const cleanUp = () => URL.revokeObjectURL(objectUrl);

    image.onload = () => {
      const dimensions = {
        width: image.naturalWidth,
        height: image.naturalHeight,
      };
      cleanUp();
      resolve(dimensions);
    };
    image.onerror = () => {
      cleanUp();
      reject(new Error("Image decode failed"));
    };
    image.src = objectUrl;
  });
}

export async function validateFloorPlanContents(file: File) {
  try {
    const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const isJpeg = hasJpegSignature(header);
    const isPng = hasPngSignature(header);
    const mimeType = file.type.toLowerCase();

    if (
      (!isJpeg && !isPng) ||
      (mimeType === "image/jpeg" && !isJpeg) ||
      (mimeType === "image/png" && !isPng)
    ) {
      return "This file is not a valid JPG or PNG image.";
    }

    const { width, height } = await readImageDimensions(file);
    if (width === 0 || height === 0) {
      return "This image has no readable dimensions.";
    }

    if (width * height > MAX_FLOOR_PLAN_PIXEL_COUNT) {
      return "This image has very large dimensions. Resize it below 40 megapixels.";
    }

    return null;
  } catch {
    return "Roomie could not decode this image. Choose a valid JPG or PNG.";
  }
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getUploadSessionKey(id: string, ownerUserId: string) {
  return `${ownerUserId}\u0000${id}`;
}

function getHostedProjectAsset(
  value: unknown,
  projectId: string,
  label: HostedImageLabel,
) {
  if (typeof value !== "string") return null;

  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      !PUTER_HOST.test(url.hostname)
    ) {
      return null;
    }

    const segments = url.pathname.split("/").filter(Boolean);
    if (
      segments.length !== 3 ||
      segments[0] !== "projects" ||
      decodeURIComponent(segments[1]) !== projectId ||
      !new RegExp(`^${label}\\.(?:jpg|png)$`).test(segments[2])
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function assertSavedProject(project: DesignItem, file: FloorPlanFileMetadata) {
  if (typeof project.id !== "string" || !SAFE_PROJECT_ID.test(project.id)) {
    throw new Error("The saved project ID is invalid.");
  }
  if (typeof project.ownerId !== "string" || !project.ownerId.trim()) {
    throw new Error("A saved project must belong to a signed-in user.");
  }
  if (
    typeof project.name !== "string" ||
    !project.name.trim() ||
    project.name.length > 100
  ) {
    throw new Error("A saved project must have a name.");
  }
  if (
    !Number.isFinite(project.timestamp) ||
    project.timestamp < 0 ||
    project.timestamp > MAX_DATE_TIMESTAMP
  ) {
    throw new Error("The saved project timestamp is invalid.");
  }
  if (project.visibility !== "private" && project.visibility !== "public") {
    throw new Error("The saved project visibility is invalid.");
  }
  if (project.assetAccess !== "public-hosted") {
    throw new Error("The saved project asset access is invalid.");
  }
  const sourceImage = getHostedProjectAsset(
    project.sourceImage,
    project.id,
    "source",
  );
  if (!sourceImage) {
    throw new Error("The saved project source must be a hosted Puter image.");
  }

  const sourceUrl = new URL(sourceImage);
  const sourcePath = sourceUrl.pathname.replace(/^\/+/, "");
  if (project.sourcePath !== sourcePath) {
    throw new Error("The saved project source path is invalid.");
  }
  if (
    typeof project.publicPath !== "string" ||
    project.publicPath !==
      `${sourceUrl.origin}/projects/${encodeURIComponent(project.id)}`
  ) {
    throw new Error("The saved project public path is invalid.");
  }

  if (project.renderedImage === undefined) {
    if (project.renderedPath !== undefined) {
      throw new Error("A rendered path requires a rendered image.");
    }
  } else {
    const renderedImage = getHostedProjectAsset(
      project.renderedImage,
      project.id,
      "rendered",
    );
    if (!renderedImage) {
      throw new Error("The saved project render must be a hosted Puter image.");
    }

    const renderedUrl = new URL(renderedImage);
    if (
      renderedUrl.hostname !== sourceUrl.hostname ||
      project.renderedPath !== renderedUrl.pathname.replace(/^\/+/, "")
    ) {
      throw new Error("The saved project render path is invalid.");
    }
  }

  const validationError = validateFloorPlanFile(file);
  if (validationError) throw new Error(validationError);

  if (
    project.fileName !== file.name ||
    project.fileSize !== file.size ||
    project.mimeType.toLowerCase() !== file.type.toLowerCase()
  ) {
    throw new Error("The saved project metadata does not match the upload.");
  }
}

function copySavedProject(project: DesignItem): DesignItem {
  const copy: DesignItem = {
    id: project.id,
    name: project.name,
    sourceImage: project.sourceImage,
    timestamp: project.timestamp,
    ownerId: project.ownerId,
    visibility: project.visibility,
    assetAccess: project.assetAccess,
    sourcePath: project.sourcePath,
    publicPath: project.publicPath,
    fileName: project.fileName,
    fileSize: project.fileSize,
    mimeType: project.mimeType.toLowerCase(),
  };

  if (project.renderedImage !== undefined) {
    copy.renderedImage = project.renderedImage;
    copy.renderedPath = project.renderedPath;
  }

  return copy;
}

export function createFloorPlanUploadSession(
  project: DesignItem,
  file: FloorPlanFileMetadata,
) {
  assertSavedProject(project, file);

  const savedProject = Object.freeze(copySavedProject(project));

  const session: FloorPlanUploadSession = Object.freeze({
    id: savedProject.id,
    ownerUserId: savedProject.ownerId,
    project: savedProject,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type.toLowerCase(),
    createdAt: Date.now(),
  });

  const sessionKey = getUploadSessionKey(session.id, session.ownerUserId);
  uploadSessions.delete(sessionKey);
  uploadSessions.set(sessionKey, session);

  while (uploadSessions.size > MAX_ACTIVE_UPLOAD_SESSIONS) {
    const oldestId = uploadSessions.keys().next().value;

    if (!oldestId) break;
    uploadSessions.delete(oldestId);
  }

  return session;
}

export function getFloorPlanUploadSession(id: string, ownerUserId: string) {
  if (!id || !ownerUserId) return null;
  return uploadSessions.get(getUploadSessionKey(id, ownerUserId)) ?? null;
}

export function removeFloorPlanUploadSession(
  id: string,
  ownerUserId: string,
) {
  if (!id || !ownerUserId) return false;
  return uploadSessions.delete(getUploadSessionKey(id, ownerUserId));
}

export function listFloorPlanProjectsForOwner(ownerUserId: string) {
  if (!ownerUserId) return [];

  return [...uploadSessions.values()]
    .filter((session) => session.ownerUserId === ownerUserId)
    .sort(
      (left, right) =>
        right.project.timestamp - left.project.timestamp ||
        right.createdAt - left.createdAt,
    )
    .map((session) => session.project);
}

export function clearFloorPlanUploadSessionsForOwner(ownerUserId: string) {
  if (!ownerUserId) return;

  for (const [sessionKey, session] of uploadSessions) {
    if (session.ownerUserId === ownerUserId) {
      uploadSessions.delete(sessionKey);
    }
  }
}

export function createVisualizerNavigationState(
  session: FloorPlanUploadSession,
): VisualizerNavigationState {
  const state: VisualizerNavigationState = Object.freeze({
    version: 1,
    project: Object.freeze(copySavedProject(session.project)),
    createdAt: session.createdAt,
  });

  const validated = getVisualizerNavigationState(
    state,
    session.id,
    session.ownerUserId,
  );
  if (!validated) {
    throw new Error("The saved project cannot be serialized for navigation.");
  }

  return state;
}

export function getVisualizerNavigationState(
  value: unknown,
  projectId: string,
  ownerUserId: string,
): FloorPlanUploadSession | null {
  if (!value || typeof value !== "object") return null;

  try {
    const state = value as Partial<VisualizerNavigationState>;
    if (
      state.version !== 1 ||
      !projectId ||
      !ownerUserId ||
      !state.project ||
      state.project.id !== projectId ||
      state.project.ownerId !== ownerUserId ||
      typeof state.createdAt !== "number" ||
      !Number.isFinite(state.createdAt) ||
      state.createdAt < 0 ||
      state.createdAt > MAX_DATE_TIMESTAMP
    ) {
      return null;
    }

    const candidate = state.project;
    assertSavedProject(candidate, {
      name: candidate.fileName,
      size: candidate.fileSize,
      type: candidate.mimeType,
    });

    const project = Object.freeze(copySavedProject(candidate));
    return Object.freeze({
      id: project.id,
      ownerUserId: project.ownerId,
      project,
      fileName: project.fileName,
      fileSize: project.fileSize,
      mimeType: project.mimeType,
      createdAt: state.createdAt,
    });
  } catch {
    return null;
  }
}
