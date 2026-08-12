export const HOSTING_CONFIG_KEY = "roomie:hosting-config:v1";
export const HOSTING_DOMAIN_SUFFIX = "puter.site";
export const HOSTING_ROOT_DIRECTORY = "roomie-hosting";

const HOSTING_SLUG_PREFIX = "roomie-";
const MAX_HOSTED_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_HOSTED_IMAGE_PIXEL_COUNT = 40_000_000;
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SAFE_HOSTED_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const VALID_SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export type HostedImageContentType = "image/jpeg" | "image/png";
export type HostedImageExtension = "jpg" | "png";

export interface ResolvedImageBlob {
  blob: Blob;
  contentType: string;
}

export interface VerifiedImageBlob {
  blob: Blob;
  contentType: HostedImageContentType;
  extension: HostedImageExtension;
}

function randomHex(byteLength: number) {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Secure random values are unavailable in this browser.");
  }

  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createHostingSlug() {
  return `${HOSTING_SLUG_PREFIX}${randomHex(12)}`;
}

export function isValidHostingSubdomain(subdomain: string) {
  return VALID_SUBDOMAIN.test(subdomain) && subdomain.length <= 63;
}

export function assertSafePathSegment(value: string, name: string) {
  if (!SAFE_PATH_SEGMENT.test(value)) {
    throw new Error(
      `${name} must start with a letter or number and contain only letters, numbers, underscores, or hyphens.`,
    );
  }

  return value;
}

function assertSafeHostedPathSegment(value: string) {
  if (
    value === "." ||
    value === ".." ||
    !SAFE_HOSTED_PATH_SEGMENT.test(value)
  ) {
    throw new Error("The hosted file path is invalid.");
  }

  return value;
}

function isLocalHttpUrl(url: URL) {
  return (
    import.meta.env.DEV &&
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  );
}

function assertSupportedImageUrl(value: string) {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error("The image URL is invalid.");
  }

  if (
    parsed.protocol !== "data:" &&
    parsed.protocol !== "blob:" &&
    parsed.protocol !== "https:" &&
    !isLocalHttpUrl(parsed)
  ) {
    throw new Error("Only data, blob, or HTTPS image URLs are supported.");
  }

  return parsed;
}

export async function fetchBlobFromUrl(
  value: string,
  signal?: AbortSignal,
): Promise<ResolvedImageBlob> {
  if (typeof window === "undefined") {
    throw new Error("Image resolution is available only in a browser.");
  }

  const parsed = assertSupportedImageUrl(value);
  const requestOptions: RequestInit = { signal };

  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    requestOptions.cache = "no-store";
    requestOptions.credentials = "omit";
  }

  const response = await fetch(parsed, requestOptions);

  if (!response.ok) {
    throw new Error(`The image request failed with status ${response.status}.`);
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_HOSTED_IMAGE_SIZE_BYTES
  ) {
    throw new Error("The image is larger than 10 MB.");
  }

  const contentType = response.headers.get("content-type") || "";
  let blob: Blob;

  if (response.body) {
    const reader = response.body.getReader();
    const chunks: ArrayBuffer[] = [];
    let receivedBytes = 0;

    try {
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;

        receivedBytes += chunk.byteLength;
        if (receivedBytes > MAX_HOSTED_IMAGE_SIZE_BYTES) {
          await reader.cancel("The image is larger than 10 MB.");
          throw new Error("The image is larger than 10 MB.");
        }

        const copy = new Uint8Array(chunk.byteLength);
        copy.set(chunk);
        chunks.push(copy.buffer);
      }
    } finally {
      reader.releaseLock();
    }

    blob = new Blob(chunks, { type: contentType });
  } else {
    blob = await response.blob();
  }

  if (blob.size === 0) throw new Error("The image is empty.");
  if (blob.size > MAX_HOSTED_IMAGE_SIZE_BYTES) {
    throw new Error("The image is larger than 10 MB.");
  }

  return {
    blob,
    contentType: contentType || blob.type || "",
  };
}

function hasJpegSignature(bytes: Uint8Array) {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function hasPngSignature(bytes: Uint8Array) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return signature.every((byte, index) => bytes[index] === byte);
}

async function getImageDimensions(blob: Blob) {
  if (typeof globalThis.createImageBitmap === "function") {
    const bitmap = await globalThis.createImageBitmap(blob);

    try {
      return { width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close();
    }
  }

  if (typeof Image === "undefined") {
    throw new Error("Image decoding is unavailable in this environment.");
  }

  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
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
      reject(new Error("The image could not be decoded."));
    };
    image.src = objectUrl;
  });
}

export async function verifyImageBlob(blob: Blob): Promise<VerifiedImageBlob> {
  if (blob.size === 0) throw new Error("The image is empty.");
  if (blob.size > MAX_HOSTED_IMAGE_SIZE_BYTES) {
    throw new Error("The image is larger than 10 MB.");
  }

  const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const contentType: HostedImageContentType = hasPngSignature(header)
    ? "image/png"
    : hasJpegSignature(header)
      ? "image/jpeg"
      : (() => {
          throw new Error("Only valid JPG and PNG images can be hosted.");
        })();
  const declaredType = blob.type.split(";", 1)[0].trim().toLowerCase();

  if (
    declaredType &&
    declaredType !== "application/octet-stream" &&
    declaredType !== contentType
  ) {
    throw new Error("The image content does not match its declared type.");
  }

  const { width, height } = await getImageDimensions(blob);
  if (width === 0 || height === 0) {
    throw new Error("The image has no readable dimensions.");
  }
  if (width * height > MAX_HOSTED_IMAGE_PIXEL_COUNT) {
    throw new Error("The image must be smaller than 40 megapixels.");
  }

  return {
    blob:
      blob.type === contentType
        ? blob
        : new Blob([await blob.arrayBuffer()], { type: contentType }),
    contentType,
    extension: contentType === "image/png" ? "png" : "jpg",
  };
}

async function renderBlobToPng(blob: Blob) {
  if (typeof document === "undefined") {
    throw new Error("PNG conversion is available only in a browser.");
  }

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas rendering is unavailable.");

  if (typeof globalThis.createImageBitmap === "function") {
    const bitmap = await globalThis.createImageBitmap(blob);

    try {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      context.drawImage(bitmap, 0, 0);
    } finally {
      bitmap.close();
    }
  } else {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const objectUrl = URL.createObjectURL(blob);
      const element = new Image();

      element.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(element);
      };
      element.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("The image could not be decoded."));
      };
      element.src = objectUrl;
    });

    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    context.drawImage(image, 0, 0);
  }

  const png = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });

  if (!png) throw new Error("The image could not be converted to PNG.");
  return png;
}

export async function imageUrlToPngBlob(
  url: string,
  signal?: AbortSignal,
) {
  const resolved = await fetchBlobFromUrl(url, signal);
  const verified = await verifyImageBlob(resolved.blob);

  if (verified.contentType === "image/png") return verified.blob;

  const png = await renderBlobToPng(verified.blob);
  const verifiedPng = await verifyImageBlob(png);
  return verifiedPng.blob;
}

export function getImageExtension(
  contentType: string,
  sourceUrl = "",
): HostedImageExtension | null {
  const normalizedType = contentType.split(";", 1)[0].trim().toLowerCase();
  if (normalizedType === "image/png") return "png";
  if (normalizedType === "image/jpeg" || normalizedType === "image/jpg") {
    return "jpg";
  }

  try {
    const extension = new URL(sourceUrl).pathname.split(".").pop()?.toLowerCase();
    if (extension === "png") return "png";
    if (extension === "jpg" || extension === "jpeg") return "jpg";
  } catch {
    return null;
  }

  return null;
}

export function isHostedUrl(url: string, subdomain: string) {
  if (!isValidHostingSubdomain(subdomain)) return false;

  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === `${subdomain}.${HOSTING_DOMAIN_SUFFIX}` &&
      parsed.port === "" &&
      parsed.username === "" &&
      parsed.password === ""
    );
  } catch {
    return false;
  }
}

export function getHostedUrl(subdomain: string, filePath: string) {
  if (!isValidHostingSubdomain(subdomain)) return null;

  const segments = filePath.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  try {
    const encodedPath = segments
      .map((segment) => encodeURIComponent(assertSafeHostedPathSegment(segment)))
      .join("/");
    return new URL(
      `/${encodedPath}`,
      `https://${subdomain}.${HOSTING_DOMAIN_SUFFIX}`,
    ).toString();
  } catch {
    return null;
  }
}
