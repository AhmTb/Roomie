export const ROOMIE_RENDER_PROMPT = `TASK: Convert the input 2D floor plan into a **photorealistic, top-down 3D architectural render**.

STRICT REQUIREMENTS (do not violate):
1) **REMOVE ALL TEXT**: Do not render any letters, numbers, labels, dimensions, or annotations. Floors must be continuous where text used to be.
2) **GEOMETRY MUST MATCH**: Walls, rooms, doors, and windows must follow the exact lines and positions in the plan. Do not shift or resize.
3) **TOP-DOWN ONLY**: Orthographic top-down view. No perspective tilt.
4) **CLEAN, REALISTIC OUTPUT**: Crisp edges, balanced lighting, and realistic materials. No sketch/hand-drawn look.
5) **NO EXTRA CONTENT**: Do not add rooms, furniture, or objects that are not clearly indicated by the plan.

STRUCTURE & DETAILS:
- **Walls**: Extrude precisely from the plan lines. Consistent wall height and thickness.
- **Doors**: Convert door swing arcs into open doors, aligned to the plan.
- **Windows**: Convert thin perimeter lines into realistic glass windows.

FURNITURE & ROOM MAPPING (only where icons/fixtures are clearly shown):
- Bed icon → realistic bed with duvet and pillows.
- Sofa icon → modern sectional or sofa.
- Dining table icon → table with chairs.
- Kitchen icon → counters with sink and stove.
- Bathroom icon → toilet, sink, and tub/shower.
- Office/study icon → desk, chair, and minimal shelving.
- Porch/patio/balcony icon → outdoor seating or simple furniture (keep minimal).
- Utility/laundry icon → washer/dryer and minimal cabinetry.

STYLE & LIGHTING:
- Lighting: bright, neutral daylight. High clarity and balanced contrast.
- Materials: realistic wood/tile floors, clean walls, subtle shadows.
- Finish: professional architectural visualization; no text, no watermarks, no logos.`;

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
          ratio: { w: number; h: number };
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
      const response = await dependencies.puterClient.ai.txt2img(
        ROOMIE_RENDER_PROMPT,
        {
          provider: "gemini",
          model: "nano-banana",
          input_image: preparedSource.dataUrl,
          input_image_mime_type: preparedSource.mimeType,
          quality: "1K",
          ratio: { w: 16, h: 9 },
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
