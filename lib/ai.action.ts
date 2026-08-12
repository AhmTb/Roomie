import puter from "@heyputer/puter.js";

import {
  assertReliableAccountCoordination,
  assertValidGenerationRequest,
  generate3DViewWithDependencies,
  ROOMIE_RENDER_PROMPT,
} from "./ai.generation";
import {
  getPuterAccountVersion,
  hasReliablePuterAccountCoordination,
  withPuterAccountIntentLock,
  withPuterAccountLock,
} from "./puter.account";
import { fetchBlobFromUrl, verifyImageBlob } from "./utils";

export { ROOMIE_RENDER_PROMPT };

function createAbortError() {
  return new DOMException("The image generation was cancelled.", "AbortError");
}

async function blobToDataUrl(blob: Blob, signal?: AbortSignal) {
  signal?.throwIfAborted();

  if (typeof FileReader === "undefined") {
    throw new Error("Image encoding is unavailable in this browser.");
  }

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    const cleanUp = () => {
      signal?.removeEventListener("abort", handleAbort);
      reader.onload = null;
      reader.onerror = null;
      reader.onabort = null;
    };
    const handleAbort = () => {
      if (reader.readyState === FileReader.LOADING) reader.abort();
      cleanUp();
      reject(signal?.reason ?? createAbortError());
    };

    reader.onload = () => {
      const result = reader.result;
      cleanUp();

      if (typeof result !== "string") {
        reject(new Error("The image could not be encoded for AI generation."));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => {
      const error = reader.error;
      cleanUp();
      reject(error ?? new Error("The image could not be encoded."));
    };
    reader.onabort = () => {
      cleanUp();
      reject(createAbortError());
    };
    signal?.addEventListener("abort", handleAbort, { once: true });
    reader.readAsDataURL(blob);
  });
}

export async function fetchAsDataUrl(url: string, signal?: AbortSignal) {
  const { blob } = await fetchBlobFromUrl(url, signal);
  const verified = await verifyImageBlob(blob);
  signal?.throwIfAborted();
  return {
    dataUrl: await blobToDataUrl(verified.blob, signal),
    mimeType: verified.contentType,
  };
}

export async function generate3DView(
  params: Generate3DViewParams,
  options?: Generate3DViewOptions,
): Promise<Generated3DView> {
  assertValidGenerationRequest(params);
  assertReliableAccountCoordination(hasReliablePuterAccountCoordination());
  const preparedSource = await fetchAsDataUrl(params.sourceImage, params.signal);
  return generate3DViewWithDependencies(params, preparedSource, {
    puterClient: puter,
    normalizeGeneratedImage: async (url, signal) =>
      (await fetchAsDataUrl(url, signal)).dataUrl,
    getAccountVersion: getPuterAccountVersion,
    hasReliableAccountCoordination: hasReliablePuterAccountCoordination,
    withAccountIntentLock: withPuterAccountIntentLock,
    withAccountLock: (operation) =>
      withPuterAccountLock(() => operation()),
  }, options);
}
