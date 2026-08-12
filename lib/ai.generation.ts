export const ROOMIE_RENDER_PROMPT = `STRICT IMAGE-EDITING TASK — DO NOT REDESIGN.

Treat the uploaded floor plan as an immutable blueprint and convert only its visual style into a photorealistic architectural render. Preserve the source image's original orientation—portrait, landscape, or square—and its original canvas aspect ratio. Preserve the outer footprint, scale, proportions, wall thicknesses, and the exact coordinates of every exterior wall, interior partition, doorway, door swing, window, fixture, and furniture symbol. Never rotate, crop, stretch, reflow, simplify, mirror, or reinterpret the plan. No room or object may move, resize, merge, split, appear, or disappear. If realism conflicts with geometry, preserve geometry.

Before rendering, internally trace the complete building footprint, every wall centerline and boundary, every opening, and every fixture and furniture position. Use that trace as a locked spatial constraint. The final outer silhouette and every internal partition must align with the source plan without displacement.

Use room labels only as hidden semantic evidence before rendering: preserve the exact number, purpose, and boundary of every distinctly labeled space, including secondary kitchens, utility rooms, bathrooms, porches, patios, and balconies. Never convert one labeled room type into another. Then REMOVE ALL TEXT AND DRAFTING MARKS from the output. Erase every letter, number, room name, dimension, annotation, leader line, measurement line, and exterior dimension mark. Do not reproduce or invent any text. Do not mistake text, dimensions, or annotation strokes for walls. Replace removed interior text with uninterrupted matching floor material and keep the underlying room open and continuous.

Convert only symbols and fixtures that are visibly present in the source. Keep each item's exact count, footprint, position, and orientation. A bed symbol becomes one realistic bed; a sofa remains a sofa; a dining set keeps the same table and chair count; kitchen counters, sink, and stove remain in their drawn locations; bathroom fixtures remain separate and fixed; storage, office, laundry, porch, patio, or balcony items appear only when explicitly drawn. Do not add decoration, plants, rugs, shelves, seating, appliances, or any other object without a matching source symbol.

Render a true 90-degree orthographic bird's-eye view: top-down only, no perspective tilt, no isometric angle, no dollhouse angle, and no roof. Extrude the traced walls uniformly with consistent low wall height and thickness. Convert door swing arcs into open doors at the original hinge, angle, and opening. Convert perimeter window marks into realistic glass windows at the exact original spans.

Use bright neutral daylight, restrained realistic wood and tile materials, clean walls, crisp edges, balanced contrast, and subtle shadows. Keep materials subordinate to the plan geometry. Produce a clean professional architectural visualization with no text, watermark, logo, caption, border, or extra content.

FINAL CHECK BEFORE OUTPUT: compare the render against the source as if overlaying both images. The canvas orientation, footprint, partitions, openings, fixtures, and furniture count must match. If anything does not align, correct it before returning the image.`;

type GeneratedImage = { src?: string | null };

export type PreparedSourceImage = {
  dataUrl: string;
  mimeType: "image/jpeg" | "image/png";
};

export class GeneratedImageNormalizationError extends Error {
  constructor(options?: ErrorOptions) {
    super(
      "The AI model returned an image, but Roomie could not prepare it for display.",
      options,
    );
    this.name = "GeneratedImageNormalizationError";
  }
}

export type AIActionDependencies = {
  puterClient: {
    auth: {
      getUser: () => Promise<{ uuid?: string | null } | null>;
    };
    ai: {
      txt2img: (
        prompt: string,
        options: {
          provider: string;
          model: string;
          input_image: string;
          input_image_mime_type: string;
          quality: string;
        },
      ) => Promise<GeneratedImage>;
    };
  };
  normalizeGeneratedImage: (
    url: string,
    signal?: AbortSignal,
  ) => Promise<string>;
  getAccountVersion: () => string;
  hasReliableAccountCoordination: () => boolean;
  withAccountIntentLock: <T>(
    operation: () => T | Promise<T>,
  ) => Promise<T>;
  withAccountLock: <T>(
    operation: () => T | Promise<T>,
  ) => Promise<T | null>;
};

export function assertValidGenerationRequest({
  sourceImage,
  expectedOwnerUserId,
  authorization,
}: Generate3DViewParams) {
  if (
    typeof sourceImage !== "string" ||
    !sourceImage ||
    typeof expectedOwnerUserId !== "string" ||
    !expectedOwnerUserId.trim() ||
    !authorization ||
    authorization.expectedOwnerUserId !== expectedOwnerUserId ||
    typeof authorization.accountVersion !== "string" ||
    !authorization.accountVersion
  ) {
    throw new Error("The AI generation request is invalid.");
  }
}

export function assertReliableAccountCoordination(isReliable: boolean) {
  if (!isReliable) {
    throw new Error(
      "This browser cannot safely coordinate AI generation across tabs.",
    );
  }
}

async function assertAuthorizedOwner(
  expectedOwnerUserId: string,
  accountVersion: string,
  dependencies: AIActionDependencies,
) {
  if (dependencies.getAccountVersion() !== accountVersion) {
    throw new Error("The Puter account changed during AI generation.");
  }

  const currentUser = await dependencies.puterClient.auth.getUser();
  if (dependencies.getAccountVersion() !== accountVersion) {
    throw new Error("The Puter account changed during AI generation.");
  }
  if (currentUser?.uuid !== expectedOwnerUserId) {
    throw new Error("The signed-in Puter account changed during AI generation.");
  }
}

export async function generate3DViewWithDependencies(
  params: Generate3DViewParams,
  preparedSource: PreparedSourceImage,
  dependencies: AIActionDependencies,
  options: Generate3DViewOptions = {},
): Promise<Generated3DView> {
  assertValidGenerationRequest(params);
  assertReliableAccountCoordination(
    dependencies.hasReliableAccountCoordination(),
  );

  if (
    !preparedSource ||
    typeof preparedSource.dataUrl !== "string" ||
    !/^data:image\/(?:jpeg|png);base64,/i.test(preparedSource.dataUrl) ||
    (preparedSource.mimeType !== "image/jpeg" &&
      preparedSource.mimeType !== "image/png")
  ) {
    throw new Error("The source image payload is invalid.");
  }

  const {
    expectedOwnerUserId,
    authorization,
    signal,
  } = params;

  const result = await dependencies.withAccountIntentLock(() =>
    dependencies.withAccountLock(async () => {
      signal?.throwIfAborted();
      await assertAuthorizedOwner(
        expectedOwnerUserId,
        authorization.accountVersion,
        dependencies,
      );

      signal?.throwIfAborted();
      await assertAuthorizedOwner(
        expectedOwnerUserId,
        authorization.accountVersion,
        dependencies,
      );
      signal?.throwIfAborted();

      if (options.beforeProviderRequest) {
        const mayStart = await options.beforeProviderRequest(signal);
        signal?.throwIfAborted();
        if (!mayStart) {
          throw new Error(
            "The automatic AI generation reservation is no longer valid.",
          );
        }
      }

      // Puter does not currently expose an AbortSignal for txt2img. The
      // surrounding checks prevent stale results from being accepted, while
      // the account lock keeps the billed Puter identity stable during the call.
      // Do not pass `ratio`: Gemini image editing defaults to the input image's
      // dimensions, while an explicit ratio overrides the source canvas.
      const response = await dependencies.puterClient.ai.txt2img(
        ROOMIE_RENDER_PROMPT,
        {
          provider: "gemini",
          model: "nano-banana",
          input_image: preparedSource.dataUrl,
          input_image_mime_type: preparedSource.mimeType,
          quality: "1K",
        },
      );

      signal?.throwIfAborted();
      await assertAuthorizedOwner(
        expectedOwnerUserId,
        authorization.accountVersion,
        dependencies,
      );

      const rawImageUrl = response?.src;
      if (typeof rawImageUrl !== "string" || !rawImageUrl) {
        throw new Error("The AI model did not return an image.");
      }

      return rawImageUrl;
    }),
  );

  if (!result) {
    throw new Error("Roomie could not acquire the Puter account lock.");
  }

  let renderedImage: string;
  try {
    renderedImage = await dependencies.normalizeGeneratedImage(result, signal);
  } catch (error) {
    if (signal?.aborted) signal.throwIfAborted();
    throw new GeneratedImageNormalizationError({ cause: error });
  }
  signal?.throwIfAborted();

  // Result normalization is intentionally outside the global Puter locks. The
  // authorization snapshot is still revalidated before the render is exposed.
  await assertAuthorizedOwner(
    expectedOwnerUserId,
    authorization.accountVersion,
    dependencies,
  );
  signal?.throwIfAborted();

  return { renderedImage, renderedPath: undefined };
}
