export const MAX_FLOOR_PLAN_SIZE_BYTES = 10 * 1024 * 1024;

export const ACCEPTED_FLOOR_PLAN_TYPES = [
  "image/jpeg",
  "image/png",
] as const;

export const FLOOR_PLAN_ACCEPT_ATTRIBUTE = ".jpg,.jpeg,.png";

const MAX_ACTIVE_UPLOAD_SESSIONS = 1;
const MAX_FLOOR_PLAN_PIXEL_COUNT = 40_000_000;

export interface FloorPlanUploadSession {
  id: string;
  ownerUserId: string;
  dataUrl: string;
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

export function createFloorPlanUploadSession(
  dataUrl: string,
  file: FloorPlanFileMetadata,
  ownerUserId: string,
) {
  if (!ownerUserId) {
    throw new Error("A signed-in user is required to create an upload session.");
  }

  const id =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  const session: FloorPlanUploadSession = {
    id,
    ownerUserId,
    dataUrl,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type,
    createdAt: Date.now(),
  };

  uploadSessions.set(id, session);

  while (uploadSessions.size > MAX_ACTIVE_UPLOAD_SESSIONS) {
    const oldestId = uploadSessions.keys().next().value;

    if (!oldestId) break;
    uploadSessions.delete(oldestId);
  }

  return session;
}

export function getFloorPlanUploadSession(id: string, ownerUserId: string) {
  const session = uploadSessions.get(id);

  if (!ownerUserId || session?.ownerUserId !== ownerUserId) return null;
  return session;
}

export function clearFloorPlanUploadSessionsForOwner(ownerUserId: string) {
  if (!ownerUserId) return;

  for (const [id, session] of uploadSessions) {
    if (session.ownerUserId === ownerUserId) uploadSessions.delete(id);
  }
}
