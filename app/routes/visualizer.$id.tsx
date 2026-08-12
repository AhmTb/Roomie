import {
  ArrowLeft,
  Box,
  CheckCircle2,
  Download,
  ImageIcon,
} from "lucide-react";
import { Link } from "react-router";

import Button from "../../components/UI/button";
import {
  formatFileSize,
  getFloorPlanUploadSession,
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
  const upload = getFloorPlanUploadSession(params.id);

  if (!upload) {
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
          <p className="eyebrow">No active upload</p>
          <h1 id="missing-upload-title">Choose a floor plan to begin.</h1>
          <p>
            Local upload previews last for the current page. Upload the plan
            again if you refreshed or opened this link in a new tab.
          </p>
          <Link className="btn btn--primary btn--md" to="/#upload">
            <ArrowLeft /> Back to upload
          </Link>
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
              <h1 id="workspace-title">{upload.fileName}</h1>
              <span className="note">
                {formatFileSize(upload.fileSize)} · {upload.mimeType}
              </span>
            </div>

            <div className="panel-actions">
              <a
                className="btn btn--outline btn--sm"
                href={upload.dataUrl}
                download={upload.fileName}
              >
                <Download /> Download original
              </a>
              <Button className="export" size="sm" disabled>
                Rendering comes next
              </Button>
            </div>
          </div>

          <div className="render-area source-preview">
            <img
              className="render-img"
              src={upload.dataUrl}
              alt={`Uploaded floor plan: ${upload.fileName}`}
            />
            <span className="source-badge">
              <CheckCircle2 /> Read locally and ready
            </span>
          </div>
        </section>

        <aside className="workspace-note" aria-label="Upload status">
          <CheckCircle2 aria-hidden="true" />
          <div>
            <strong>Upload mechanism complete</strong>
            <p>
              The image has been validated and read in this browser. Permanent
              cloud hosting and AI rendering are separate workflow steps.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
