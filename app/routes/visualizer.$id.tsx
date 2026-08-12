import {
  ArrowLeft,
  Box,
  CheckCircle2,
  ExternalLink,
  ImageIcon,
} from "lucide-react";
import { Link, useLocation, useOutletContext } from "react-router";

import Button from "../../components/UI/button";
import {
  formatFileSize,
  getFloorPlanUploadSession,
  getVisualizerNavigationState,
} from "../../lib/upload";
import type { Route } from "./+types/visualizer.$id";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Floor plan workspace — Roomie" },
    {
      name: "description",
      content: "Review a floor plan prepared for a Roomie design workspace.",
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
    <main className="visualizer">
      <header className="topbar">
        <Link className="brand" to="/" aria-label="Roomie home">
          <Box className="logo" />
          <span className="name">Roomie</span>
        </Link>
        <Link className="btn btn--ghost btn--sm exit" to="/#upload">
          <ArrowLeft className="icon" /> Upload another
        </Link>
      </header>

      <div className="content">
        <section className="panel" aria-labelledby="workspace-title">
          <div className="panel-header">
            <div className="panel-meta">
              <p>Source floor plan</p>
              <h1 id="workspace-title">{upload.project.name}</h1>
              <span className="note">
                {upload.fileName} · {formatFileSize(upload.fileSize)} ·{" "}
                {upload.mimeType}
              </span>
            </div>

            <div className="panel-actions">
              <a
                className="btn btn--outline btn--sm"
                href={upload.project.sourceImage}
                target="_blank"
                rel="noreferrer"
                referrerPolicy="no-referrer"
              >
                <ExternalLink /> Open original
              </a>
              <Button className="export" size="sm" disabled>
                Rendering comes next
              </Button>
            </div>
          </div>

          <div className="render-area source-preview">
            <img
              className="render-img"
              src={upload.project.sourceImage}
              alt={`Uploaded floor plan: ${upload.fileName}`}
              referrerPolicy="no-referrer"
            />
            <span className="source-badge">
              <CheckCircle2 /> Hosted on Puter and ready
            </span>
          </div>
        </section>

        <aside className="workspace-note" aria-label="Upload status">
          <CheckCircle2 aria-hidden="true" />
          <div>
            <strong>Hosted project created</strong>
            <p>
              This browser session is owner-bound, but the source image is
              available to anyone with its public Puter URL. AI rendering comes
              next.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
