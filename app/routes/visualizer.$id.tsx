import {
  AlertTriangle,
  ArrowLeft,
  Box,
  CheckCircle2,
  Download,
  ExternalLink,
  ImageIcon,
  RefreshCw,
  Share2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useOutletContext } from "react-router";

import Button from "../../components/UI/button";
import { generate3DView } from "../../lib/ai.action";
import { GeneratedImageNormalizationError } from "../../lib/ai.generation";
import { claimAutomaticGenerationAttempt } from "../../lib/ai.attempt";
import { getHostedProjectAuthorization } from "../../lib/puter.action";
import {
  formatFileSize,
  getFloorPlanUploadSession,
  getVisualizerNavigationState,
  type FloorPlanUploadSession,
} from "../../lib/upload";
import type { Route } from "./+types/visualizer.$id";

type GenerationStatus =
  | "checking"
  | "idle"
  | "processing"
  | "ready"
  | "error";

const MAX_TRANSIENT_RENDERS = 3;
const transientRenders = new Map<
  string,
  { sourceImage: string; renderedImage: string }
>();

function peekTransientRender(upload: FloorPlanUploadSession) {
  const key = `${upload.ownerUserId}\u0000${upload.project.id}`;
  const cached = transientRenders.get(key);
  return cached?.sourceImage === upload.project.sourceImage
    ? cached.renderedImage
    : null;
}

function rememberTransientRender(
  upload: FloorPlanUploadSession,
  renderedImage: string,
) {
  const key = `${upload.ownerUserId}\u0000${upload.project.id}`;
  transientRenders.delete(key);
  transientRenders.set(key, {
    sourceImage: upload.project.sourceImage,
    renderedImage,
  });

  while (transientRenders.size > MAX_TRANSIENT_RENDERS) {
    const oldestKey = transientRenders.keys().next().value;
    if (!oldestKey) break;
    transientRenders.delete(oldestKey);
  }
}

function getGenerationMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";

  if (error instanceof GeneratedImageNormalizationError) {
    return "The AI request completed, but its image could not be displayed. Retrying may use another Puter AI request.";
  }

  if (/account changed|signed-in Puter account/i.test(message)) {
    return "Your Puter account changed. Return home, confirm the active account, and try again.";
  }
  if (/coordinate AI generation/i.test(message)) {
    return "This browser cannot safely start the AI request. Enable cross-tab locks and site storage, then retry.";
  }
  if (/image request|source image|JPG|PNG|decode|larger than/i.test(message)) {
    return "Roomie could not read the hosted floor plan. Confirm the original image is still public, then retry.";
  }

  return "Roomie could not generate this visualization. No result was saved; please try again.";
}

function getDownloadName(project: DesignItem, image: string) {
  let extension = image.startsWith("data:image/jpeg") ? "jpg" : "png";
  if (!image.startsWith("data:")) {
    try {
      extension = /\.jpe?g$/i.test(new URL(image).pathname) ? "jpg" : "png";
    } catch {
      extension = "png";
    }
  }
  return `${project.id}-roomie-render.${extension}`;
}

function VisualizerWorkspace({ upload }: { upload: FloorPlanUploadSession }) {
  const [initialImage] = useState<string | null>(() =>
    upload.project.renderedImage ?? peekTransientRender(upload),
  );
  const [currentImage, setCurrentImage] = useState<string | null>(() =>
    initialImage,
  );
  const [status, setStatus] = useState<GenerationStatus>(() =>
    initialImage ? "ready" : "checking",
  );
  const [error, setError] = useState<string | null>(null);
  const activeGeneration = useRef<AbortController | null>(null);
  const generationId = useRef(0);
  const hasStartedInitialGeneration = useRef(false);
  const isProcessing = status === "processing";

  const runGeneration = useCallback(async () => {
    const requestId = ++generationId.current;
    activeGeneration.current?.abort();
    const controller = new AbortController();
    activeGeneration.current = controller;
    setStatus("processing");
    setError(null);

    try {
      const authorization = getHostedProjectAuthorization(upload.ownerUserId);
      if (!authorization) {
        throw new Error(
          "This browser cannot safely coordinate AI generation across tabs.",
        );
      }

      const result = await generate3DView({
        sourceImage: upload.project.sourceImage,
        expectedOwnerUserId: upload.ownerUserId,
        authorization,
        signal: controller.signal,
      });

      if (controller.signal.aborted || requestId !== generationId.current) {
        return;
      }

      rememberTransientRender(upload, result.renderedImage);
      setCurrentImage(result.renderedImage);
      setStatus("ready");
    } catch (generationError) {
      if (controller.signal.aborted || requestId !== generationId.current) {
        return;
      }

      console.warn("Roomie AI generation failed.", generationError);
      setError(getGenerationMessage(generationError));
      setStatus("error");
    } finally {
      if (requestId === generationId.current) {
        activeGeneration.current = null;
      }
    }
  }, [upload.ownerUserId, upload.project.sourceImage]);

  useEffect(() => {
    if (currentImage || hasStartedInitialGeneration.current) return;

    // Deferring one task prevents React Strict Mode's development-only effect
    // replay from issuing two user-paid AI requests.
    let disposed = false;
    const timer = window.setTimeout(async () => {
      if (hasStartedInitialGeneration.current) return;
      hasStartedInitialGeneration.current = true;
      const shouldGenerate = await claimAutomaticGenerationAttempt({
        ownerUserId: upload.ownerUserId,
        projectId: upload.project.id,
        sourceImage: upload.project.sourceImage,
      });
      if (disposed) return;

      if (shouldGenerate) {
        void runGeneration();
      } else {
        setStatus("idle");
      }
    }, 0);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [
    currentImage,
    runGeneration,
    upload.ownerUserId,
    upload.project.id,
    upload.project.sourceImage,
  ]);

  useEffect(
    () => () => {
      generationId.current += 1;
      activeGeneration.current?.abort();
      activeGeneration.current = null;
    },
    [],
  );

  const displayedImage = currentImage ?? upload.project.sourceImage;
  const displayedImageIsRender = !!currentImage;

  return (
    <main className="visualizer">
      <header className="topbar">
        <Link className="brand" to="/" aria-label="Roomie home">
          <Box className="logo" />
          <span className="name">Roomie</span>
        </Link>
        <Link className="btn btn--ghost btn--sm exit" to="/#projects">
          <X className="icon" /> Exit editor
        </Link>
      </header>

      <div className="content">
        <p className="sr-only" aria-live="polite">
          {status === "ready"
            ? "Visualization ready."
            : status === "error"
              ? "Visualization generation failed."
              : ""}
        </p>
        <section className="panel" aria-labelledby="workspace-title">
          <div className="panel-header">
            <div className="panel-meta">
              <p>AI visualization</p>
              <h1 id="workspace-title" className="panel-project-name">
                {upload.project.name}
              </h1>
              <span className="note panel-project-meta">
                <span>Created by you</span>
                <span aria-hidden="true">·</span>
                <span>{upload.fileName}</span>
                <span aria-hidden="true">·</span>
                <span>{formatFileSize(upload.fileSize)}</span>
              </span>
            </div>

            <div className="panel-actions">
              <a
                className="btn btn--outline btn--sm"
                href={upload.project.sourceImage}
                target="_blank"
                rel="noreferrer"
                referrerPolicy="no-referrer"
                aria-label="Open original floor plan in a new tab"
              >
                <ExternalLink /> Original
              </a>
              {currentImage ? (
                <a
                  className="render-download"
                  href={currentImage}
                  download={getDownloadName(upload.project, currentImage)}
                >
                  <Download /> Download
                </a>
              ) : (
                <Button className="export" size="sm" disabled>
                  <Download /> Download
                </Button>
              )}
              <Button
                className="share"
                variant="outline"
                size="sm"
                disabled
                title="Sharing will be available after generated renders are hosted."
              >
                <Share2 /> Share
              </Button>
            </div>
          </div>

          <div
            className={`render-area${isProcessing ? " is-processing" : ""}`}
            aria-busy={isProcessing}
          >
            {displayedImageIsRender ? (
              <img
                className="render-img"
                src={displayedImage}
                alt={`AI-generated 3D visualization of ${upload.project.name}`}
              />
            ) : (
              <div className="render-placeholder">
                <img
                  className="render-fallback"
                  src={displayedImage}
                  alt={`Original 2D floor plan for ${upload.project.name}`}
                  referrerPolicy="no-referrer"
                />
              </div>
            )}

            {isProcessing ? (
              <div className="render-overlay" role="status" aria-live="polite">
                <div className="rendering-card">
                  <RefreshCw className="spinner" aria-hidden="true" />
                  <span className="title">Rendering your space…</span>
                  <span className="subtitle">
                    Generating a furnished 3D visualization. This may take a
                    minute.
                  </span>
                </div>
              </div>
            ) : null}

            {status === "checking" ? (
              <div className="render-overlay" role="status" aria-live="polite">
                <div className="rendering-card">
                  <RefreshCw className="spinner" aria-hidden="true" />
                  <span className="title">Preparing the workspace…</span>
                  <span className="subtitle">
                    Checking this project before starting its AI render.
                  </span>
                </div>
              </div>
            ) : null}

            {status === "idle" ? (
              <div className="render-overlay">
                <div className="generation-error generation-ready">
                  <RefreshCw aria-hidden="true" />
                  <span className="title">Ready for another attempt.</span>
                  <span className="subtitle">
                    An AI request already started for this project in this
                    browser. Generate again only when you want to retry.
                  </span>
                  <button
                    className="generation-retry"
                    type="button"
                    onClick={() => void runGeneration()}
                  >
                    Generate 3D view
                  </button>
                </div>
              </div>
            ) : null}

            {status === "error" && error ? (
              <div className="render-overlay">
                <div className="generation-error" role="alert">
                  <AlertTriangle aria-hidden="true" />
                  <span className="title">The render did not finish.</span>
                  <span className="subtitle">{error}</span>
                  <button
                    className="generation-retry"
                    type="button"
                    onClick={() => void runGeneration()}
                  >
                    <RefreshCw aria-hidden="true" /> Retry generation
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <p className="render-caption">
            {upload.project.renderedImage
              ? "This hosted render was already attached to the project."
              : status === "ready"
                ? "This generated render is temporary. Download it before refreshing the page."
                : "Roomie uses the hosted floor plan as the structural reference for this render."}
          </p>
        </section>

        <aside className="workspace-note" aria-label="Project asset status">
          <CheckCircle2 aria-hidden="true" />
          <div>
            <strong>
              {status === "ready" ? "Visualization ready" : "Source secured"}
            </strong>
            <p>
              The workspace handoff is owner-bound. Your source image remains
              available to anyone with its public Puter URL; generated output
              is not uploaded or saved during this step.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Floor plan workspace — Roomie" },
    {
      name: "description",
      content: "Generate a Roomie 3D visualization from a hosted floor plan.",
    },
  ];
}

export default function Visualizer({ params }: Route.ComponentProps) {
  const location = useLocation();
  const { isAuthReady, isAuthTransitioning, isSignedIn, userId } =
    useOutletContext<AuthContext>();
  const storedUpload =
    isAuthReady && !isAuthTransitioning && isSignedIn && userId
      ? getFloorPlanUploadSession(params.id, userId)
      : null;
  const navigationUpload =
    isAuthReady && !isAuthTransitioning && isSignedIn && userId
      ? getVisualizerNavigationState(location.state, params.id, userId)
      : null;
  const upload = storedUpload ?? navigationUpload;

  if (!upload) {
    const emptyState = !isAuthReady || isAuthTransitioning
      ? {
          eyebrow: "Checking access",
          title: "Preparing your workspace.",
          copy: "Roomie is confirming your sign-in before opening this floor plan.",
        }
      : !isSignedIn || !userId
        ? {
            eyebrow: "Sign-in required",
            title: "Sign in to view this floor plan.",
            copy: "This owner-bound browser handoff is available only while the same Roomie account remains signed in.",
          }
        : {
            eyebrow: "No active upload",
            title: "Choose a floor plan to begin.",
            copy: "This upload is unavailable for the current account or browser session. Upload the plan again to continue.",
          };

    return (
      <main className="visualizer visualizer-empty">
        <Link className="brand" to="/" aria-label="Roomie home">
          <Box className="logo" />
          <span className="name">Roomie</span>
        </Link>

        <section className="empty-panel" aria-labelledby="missing-upload-title">
          <div className="empty-icon" aria-hidden="true">
            <ImageIcon />
          </div>
          <p className="eyebrow">{emptyState.eyebrow}</p>
          <h1 id="missing-upload-title">{emptyState.title}</h1>
          <p>{emptyState.copy}</p>
          {isAuthReady && !isAuthTransitioning ? (
            <Link className="btn btn--primary btn--md" to="/#upload">
              <ArrowLeft /> Back to upload
            </Link>
          ) : null}
        </section>
      </main>
    );
  }

  return (
    <VisualizerWorkspace
      key={`${upload.ownerUserId}:${upload.project.id}:${upload.project.sourceImage}:${upload.project.renderedImage ?? ""}`}
      upload={upload}
    />
  );
}
