import {
  ArrowRight,
  Box,
  Check,
  Eye,
  FileCheck,
  Layers,
  Package,
  Play,
  Sparkles,
  Upload,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router";

import Navbar from "../../components/Navbar";
import FloorPlanUpload from "../../components/Upload";
import { createProject } from "../../lib/puter.action";
import {
  createFloorPlanUploadSession,
  createVisualizerNavigationState,
  getFloorPlanUploadSession,
  listFloorPlanProjectsForOwner,
} from "../../lib/upload";
import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Roomie — AI architecture, from idea to delivery" },
    {
      name: "description",
      content:
        "Visualize, render, and ship architecture projects in one AI design environment.",
    },
  ];
}

const workflow = [
  {
    number: "01",
    icon: Sparkles,
    title: "Visualize the brief",
    copy: "Turn references, site constraints, and a written brief into a coherent spatial direction in minutes.",
  },
  {
    number: "02",
    icon: Eye,
    title: "Render every angle",
    copy: "Explore materials, light, atmosphere, and camera studies without rebuilding your model for every iteration.",
  },
  {
    number: "03",
    icon: Package,
    title: "Ship the project",
    copy: "Package approved views, decisions, schedules, and presentation-ready files into one clean delivery set.",
  },
];

const deliverables = [
  "Concept narratives",
  "Material schedules",
  "Client-ready renders",
  "Design decision logs",
];

const projectDateFormatter = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export default function Home() {
  const navigate = useNavigate();
  const {
    getAuthSnapshot,
    isAuthReady,
    isAuthTransitioning,
    isSignedIn,
    userId,
  } = useOutletContext<AuthContext>();
  const [projects, setProjects] = useState<DesignItem[]>([]);

  useEffect(() => {
    if (
      !isAuthReady ||
      isAuthTransitioning ||
      !isSignedIn ||
      !userId
    ) {
      setProjects([]);
      return;
    }

    setProjects(listFloorPlanProjectsForOwner(userId));
  }, [isAuthReady, isAuthTransitioning, isSignedIn, userId]);

  const handleUploadComplete = useCallback(
    async (base64Data: string, file: File) => {
      const currentAuth = getAuthSnapshot();

      if (
        currentAuth.isAuthTransitioning ||
        !currentAuth.isSignedIn ||
        !currentAuth.userId
      ) {
        throw new Error("Sign in before creating an upload session.");
      }

      const projectId = globalThis.crypto?.randomUUID?.();
      if (!projectId) {
        throw new Error("Secure project IDs are unavailable in this browser.");
      }

      const saved = await createProject({
        item: {
          id: projectId,
          name: `Residence ${projectId.slice(0, 8).toUpperCase()}`,
          sourceImage: base64Data,
          renderedImage: undefined,
          timestamp: Date.now(),
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
        },
        // Project discovery remains owner-bound even though Puter hosting URLs
        // are public to anyone who has the link.
        visibility: "private",
      });
      const currentAuthAfterSave = getAuthSnapshot();

      if (
        !saved ||
        currentAuthAfterSave.isAuthTransitioning ||
        !currentAuthAfterSave.isSignedIn ||
        !currentAuthAfterSave.userId ||
        currentAuthAfterSave.userId !== saved.ownerId
      ) {
        throw new Error("Roomie could not create this hosted project.");
      }

      const upload = createFloorPlanUploadSession(saved, file);
      setProjects((currentProjects) => [
        saved,
        ...currentProjects.filter((project) => project.id !== saved.id),
      ]);
      navigate(`/visualizer/${saved.id}`, {
        state: createVisualizerNavigationState(upload),
      });
    },
    [getAuthSnapshot, navigate],
  );

  return (
    <div className="home">
      <Navbar />

      <main>
        <section className="hero" id="product">
          <div className="announce">
            <span className="dot" aria-hidden="true">
              <span className="pulse" />
            </span>
            <p>AI workspace for architecture teams</p>
          </div>

          <h1>
            Imagine the space.
            <span>Roomie makes it real.</span>
          </h1>

          <p className="subtitle">
            One intelligent design environment to visualize, render, and ship
            architecture projects—from the first brief to the final handoff.
          </p>

          <div className="actions">
            <a className="cta" href="#upload">
              Start a project <ArrowRight className="icon" />
            </a>
            <a className="demo" href="#workflow">
              <Play className="icon" fill="currentColor" /> Watch the workflow
            </a>
          </div>

          <div className="upload-shell" id="upload">
            <div className="grid-overlay" aria-hidden="true" />
            <div className="upload-card">
              <div className="upload-head">
                <div className="upload-icon" aria-hidden="true">
                  <Layers className="icon" />
                </div>
                <h2>Upload your floor plan</h2>
                <p>Supports JPG or PNG images up to 10 MB</p>
              </div>
              <FloorPlanUpload onComplete={handleUploadComplete} />
            </div>
          </div>

          <div className="studio-preview" id="workspace">
            <div className="studio-bar">
              <div className="window-controls" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div className="project-name">
                <Box />
                <span>Harbor Apartment / Concept 04</span>
              </div>
              <div className="live-state">
                <span /> Live workspace
              </div>
            </div>

            <div className="studio-body">
              <aside className="tool-rail" aria-label="Design tools">
                <button className="active" type="button" aria-label="AI design">
                  <Sparkles />
                </button>
                <button type="button" aria-label="Layers">
                  <Layers />
                </button>
                <button type="button" aria-label="Upload references">
                  <Upload />
                </button>
              </aside>

              <div className="render-canvas">
                <div className="project-preview-media">
                  <img
                    className="preview-backdrop"
                    src="/images/roomie-project-preview.png"
                    alt=""
                    aria-hidden="true"
                  />
                  <img
                    className="preview-image"
                    src="/images/roomie-project-preview.png"
                    alt="AI-rendered furnished floor plan for Harbor Apartment"
                  />
                </div>

                <div className="render-label label-top">
                  <Zap /> Furnished plan · 18 sec
                </div>
                <div className="render-label label-bottom">
                  <span>2 bedroom</span>
                  <span>Warm oak</span>
                  <span>102 m²</span>
                </div>
              </div>

              <aside className="prompt-panel">
                <div className="panel-title">
                  <div>
                    <span>Roomie copilot</span>
                    <strong>Design direction</strong>
                  </div>
                  <Sparkles />
                </div>

                <div className="prompt-copy">
                  Furnish this two-bedroom apartment with a warm neutral palette,
                  clear circulation, and a calm indoor-outdoor living area.
                </div>

                <div className="decision-list">
                  <div><Check /> Preserve clear circulation</div>
                  <div><Check /> Natural oak material palette</div>
                  <div><Check /> Open living and dining zone</div>
                </div>

                <button type="button" className="generate-button">
                  Generate next study <ArrowRight />
                </button>
              </aside>
            </div>
          </div>

          <div className="trust-row" aria-label="Roomie capabilities">
            <span>Concept design</span>
            <span>AI visualization</span>
            <span>Photoreal rendering</span>
            <span>Project delivery</span>
          </div>
        </section>

        <section className="projects" id="projects" aria-labelledby="projects-title">
          <div className="section-inner">
            <div className="section-head">
              <div className="copy">
                <p className="eyebrow">Your Roomie projects</p>
                <h2 id="projects-title">Latest hosted floor plans.</h2>
                <p>
                  Projects created in this browser session appear here with
                  their lightweight Puter-hosted image URLs.
                </p>
              </div>
            </div>

            <div className="projects-grid">
              {projects.length > 0 ? (
                projects.map((project) => {
                  const session = userId
                    ? getFloorPlanUploadSession(project.id, userId)
                    : null;

                  return (
                    <Link
                      className="project-card group"
                      key={project.id}
                      to={`/visualizer/${project.id}`}
                      state={
                        session
                          ? createVisualizerNavigationState(session)
                          : undefined
                      }
                      aria-label={`Open ${project.name}`}
                    >
                      <div className="preview">
                        <img
                          src={project.renderedImage ?? project.sourceImage}
                          alt={`Floor plan for ${project.name}`}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                        <div className="badge">
                          <span>
                            {project.renderedImage
                              ? "Rendered study"
                              : "Source hosted"}
                          </span>
                        </div>
                      </div>

                      <div className="card-body">
                        <div>
                          <h3>{project.name}</h3>
                          <div className="meta">
                            <span>
                              {projectDateFormatter.format(
                                new Date(project.timestamp),
                              )}
                            </span>
                            <span>Puter hosted</span>
                          </div>
                        </div>
                        <span className="arrow" aria-hidden="true">
                          <ArrowRight />
                        </span>
                      </div>
                    </Link>
                  );
                })
              ) : (
                <div className="empty">
                  {isSignedIn
                    ? "Upload a floor plan to create your first hosted project."
                    : "Sign in with Puter to create and view hosted projects."}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="workflow" id="workflow">
          <div className="section-inner">
            <div className="section-intro">
              <p className="eyebrow">One continuous workflow</p>
              <h2>Architecture at the speed of thought.</h2>
              <p>
                Keep the design intent intact as an idea moves from conversation
                to image, and from image to a project everyone can act on.
              </p>
            </div>

            <div className="workflow-grid">
              {workflow.map(({ number, icon: Icon, title, copy }) => (
                <article className="workflow-card" key={title}>
                  <div className="card-top">
                    <span>{number}</span>
                    <Icon />
                  </div>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                  <a href="#workspace">
                    Explore the tool <ArrowRight />
                  </a>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="delivery" id="delivery">
          <div className="section-inner delivery-grid">
            <div className="delivery-copy">
              <p className="eyebrow">Built for real project work</p>
              <h2>Less tool-hopping. More design momentum.</h2>
              <p>
                Roomie keeps references, conversations, iterations, and final
                outputs connected—so your team can move quickly without losing
                the decisions that shaped the project.
              </p>

              <ul>
                {deliverables.map((item) => (
                  <li key={item}>
                    <Check /> {item}
                  </li>
                ))}
              </ul>

              <a href="#final-cta">
                See everything Roomie ships <ArrowRight />
              </a>
            </div>

            <div className="delivery-board" aria-label="Roomie project delivery board">
              <div className="board-head">
                <div>
                  <span>Delivery set</span>
                  <strong>Canopy Residence · Rev 06</strong>
                </div>
                <span className="ready-badge">Ready to share</span>
              </div>

              <div className="board-render">
                <img
                  className="board-preview"
                  src="/images/delivery-interior-render.jpg"
                  alt="Approved final visualization of the Canopy Residence living room"
                />
                <span>Final interior / Living space</span>
              </div>

              <div className="board-files">
                <div><Eye /><span><strong>Approved interior views</strong><small>6 final renders</small></span><Check /></div>
                <div><Layers /><span><strong>Material schedule</strong><small>18 specified finishes</small></span><Check /></div>
                <div><FileCheck /><span><strong>Client presentation</strong><small>16 pages · PDF</small></span><Check /></div>
              </div>
            </div>
          </div>
        </section>

        <section className="project-types">
          <div className="section-inner">
            <div className="project-type residential">
              <img
                className="project-photo"
                src="/images/residential-facade.jpg"
                alt="Geometric facade of a contemporary residential building"
              />
              <span>Residential</span>
              <h3>Homes with a point of view.</h3>
              <p>Explore massing, material, landscape, and light as one connected story.</p>
            </div>
            <div className="project-type hospitality">
              <img
                className="project-photo"
                src="/images/hospitality-lobby.jpg"
                alt="Warm modern hospitality lobby with sculptural furniture"
              />
              <span>Hospitality</span>
              <h3>Atmosphere, made visible.</h3>
              <p>Align owners and operators around a guest experience before construction begins.</p>
            </div>
            <div className="project-type workplace">
              <img
                className="project-photo"
                src="/images/workplace-interior.jpg"
                alt="Bright contemporary workplace with glass partitions"
              />
              <span>Workplace</span>
              <h3>Decisions teams can share.</h3>
              <p>Move from planning options to a presentation-ready direction without the handoff drag.</p>
            </div>
          </div>
        </section>

        <section className="final-cta" id="final-cta">
          <div className="cta-mark" aria-hidden="true"><Box /></div>
          <p className="eyebrow">Your next project starts here</p>
          <h2>Give every idea room to become architecture.</h2>
          <p>
            Bring the brief. Roomie will help your team see it, shape it, and
            ship it.
          </p>
          <a href="#upload">
            Open your first workspace <ArrowRight />
          </a>
        </section>
      </main>

      <footer className="site-footer" id="enterprise">
        <div className="footer-brand"><Box /><span>Roomie</span></div>
        <p>AI design environment for the built world.</p>
        <div className="footer-links">
          <a href="#product">Product</a>
          <a href="#workflow">Workflow</a>
          <a href="#projects">Projects</a>
        </div>
        <span>© 2026 Roomie</span>
      </footer>
    </div>
  );
}
