export const ROOMIE_RENDER_PROMPT = `Transform the supplied 2D architectural floor plan into a polished, photorealistic 3D isometric interior visualization. Preserve the exact wall layout, room boundaries, doors, windows, circulation, and proportions shown in the source. Furnish every room with realistic, appropriately scaled contemporary furniture and warm neutral materials. Use soft natural daylight, clean architectural visualization lighting, and a slightly elevated dollhouse camera angle that clearly shows the complete plan. Do not add, remove, merge, or relocate rooms, walls, doors, or windows. Do not include labels, dimensions, people, logos, watermarks, borders, or explanatory text.`;

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

function assertValidGenerationRequest({
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
): Promise<Generated3DView> {
  assertValidGenerationRequest(params);

  if (!dependencies.hasReliableAccountCoordination()) {
    throw new Error(
      "This browser cannot safely coordinate AI generation across tabs.",
    );
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

      if (
        !preparedSource ||
        typeof preparedSource.dataUrl !== "string" ||
        !/^data:image\/(?:jpeg|png);base64,/i.test(preparedSource.dataUrl) ||
        (preparedSource.mimeType !== "image/jpeg" &&
          preparedSource.mimeType !== "image/png")
      ) {
        throw new Error("The source image payload is invalid.");
      }

      signal?.throwIfAborted();
      await assertAuthorizedOwner(
        expectedOwnerUserId,
        authorization.accountVersion,
        dependencies,
      );
      signal?.throwIfAborted();

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
