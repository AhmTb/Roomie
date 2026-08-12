import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { ChangeEvent, DragEvent, KeyboardEvent } from "react";
import { CheckCircle2, ImageIcon, UploadIcon } from "lucide-react";
import { useOutletContext } from "react-router";

import {
  FLOOR_PLAN_ACCEPT_ATTRIBUTE,
  formatFileSize,
  validateFloorPlanContents,
  validateFloorPlanFile,
} from "../lib/upload";

const COMPLETION_HOLD_MS = 450;

type UploadPhase = "idle" | "reading" | "ready" | "opening";

export interface UploadProps {
  onComplete?: (base64Data: string, file: File) => void | Promise<void>;
}

const Upload = ({ onComplete }: UploadProps) => {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const readerRef = useRef<FileReader | null>(null);
  const completionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const dragDepthRef = useRef(0);
  const mountedRef = useRef(true);
  const operationIdRef = useRef(0);
  const processingRef = useRef(false);
  const signInInFlightRef = useRef(false);
  const helpId = useId();
  const errorId = useId();

  const { isAuthReady, isSignedIn, signIn } = useOutletContext<AuthContext>();

  const stopActiveProcess = useCallback(() => {
    operationIdRef.current += 1;
    processingRef.current = false;

    if (completionTimerRef.current) {
      clearTimeout(completionTimerRef.current);
      completionTimerRef.current = null;
    }

    const reader = readerRef.current;
    if (reader) {
      reader.onload = null;
      reader.onerror = null;
      reader.onabort = null;
      reader.onprogress = null;

      if (reader.readyState === FileReader.LOADING) reader.abort();
    }

    readerRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      stopActiveProcess();
    };
  }, [stopActiveProcess]);

  const resetSelection = useCallback(() => {
    stopActiveProcess();
    setFile(null);
    setPhase("idle");
    setProgress(0);
    setError(null);
    setIsDragging(false);
    dragDepthRef.current = 0;

    if (inputRef.current) inputRef.current.value = "";
  }, [stopActiveProcess]);

  useEffect(() => {
    if (isAuthReady && !isSignedIn && phase !== "idle") {
      resetSelection();
    }
  }, [isAuthReady, isSignedIn, phase, resetSelection]);

  const failUpload = useCallback(
    (message: string) => {
      stopActiveProcess();
      setFile(null);
      setPhase("idle");
      setProgress(0);
      setError(message);
    },
    [stopActiveProcess],
  );

  const processFile = useCallback(
    (nextFile: File) => {
      if (
        !isAuthReady ||
        !isSignedIn ||
        phase !== "idle" ||
        processingRef.current
      ) {
        return;
      }

      const validationError = validateFloorPlanFile(nextFile);
      if (validationError) {
        failUpload(validationError);
        return;
      }

      stopActiveProcess();
      const operationId = operationIdRef.current;
      processingRef.current = true;
      setFile(nextFile);
      setError(null);
      setProgress(1);
      setPhase("reading");

      void validateFloorPlanContents(nextFile).then((contentError) => {
        if (
          !mountedRef.current ||
          operationId !== operationIdRef.current
        ) {
          return;
        }

        if (contentError) {
          failUpload(contentError);
          return;
        }

        const reader = new FileReader();
        readerRef.current = reader;

        reader.onprogress = (event) => {
          if (!event.lengthComputable || event.total === 0) return;

          const percentage = Math.round((event.loaded / event.total) * 95);
          setProgress(Math.max(1, Math.min(95, percentage)));
        };

        reader.onerror = () => {
          failUpload("Roomie could not read this file. Try the image again.");
        };

        reader.onabort = () => {
          if (mountedRef.current) {
            failUpload("The file read was interrupted. Try again.");
          }
        };

        reader.onload = () => {
          const base64Data = reader.result;
          readerRef.current = null;
          processingRef.current = false;

          if (
            typeof base64Data !== "string" ||
            !base64Data.startsWith("data:image/")
          ) {
            failUpload(
              "Roomie could not recognize this image. Choose a JPG or PNG.",
            );
            return;
          }

          setProgress(100);
          setPhase("ready");

          if (!onComplete) return;

          completionTimerRef.current = setTimeout(() => {
            completionTimerRef.current = null;
            setPhase("opening");

            void Promise.resolve()
              .then(() => onComplete(base64Data, nextFile))
              .catch(() => {
                if (mountedRef.current) {
                  failUpload(
                    "The floor plan is ready, but the workspace could not open. Try again.",
                  );
                }
              });
          }, COMPLETION_HOLD_MS);
        };

        reader.readAsDataURL(nextFile);
      });
    },
    [
      failUpload,
      isAuthReady,
      isSignedIn,
      onComplete,
      phase,
      stopActiveProcess,
    ],
  );

  const requestSignIn = useCallback(async () => {
    if (!isAuthReady || signInInFlightRef.current) return;

    signInInFlightRef.current = true;
    setIsSigningIn(true);
    setError(null);

    try {
      const signedIn = await signIn();
      if (!signedIn && mountedRef.current) {
        setError("Sign in with Puter to upload a floor plan.");
      }
    } catch {
      if (mountedRef.current) {
        setError("Sign-in did not finish. Try again when you are ready.");
      }
    } finally {
      signInInFlightRef.current = false;
      if (mountedRef.current) setIsSigningIn(false);
    }
  }, [isAuthReady, signIn]);

  const activateDropzone = useCallback(() => {
    if (!isAuthReady || phase !== "idle") return;

    if (!isSignedIn) {
      void requestSignIn();
      return;
    }

    inputRef.current?.click();
  }, [isAuthReady, isSignedIn, phase, requestSignIn]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;

    event.preventDefault();
    activateDropzone();
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current += 1;

    if (isAuthReady && isSignedIn && phase === "idle") setIsDragging(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect =
      isAuthReady && isSignedIn && phase === "idle" ? "copy" : "none";
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);

    if (dragDepthRef.current === 0) setIsDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragging(false);

    if (!isAuthReady) {
      setError("Roomie is still checking your sign-in. Try again in a moment.");
      return;
    }

    if (!isSignedIn) {
      setError("Sign in with Puter before dropping a floor plan.");
      return;
    }

    if (event.dataTransfer.files.length !== 1) {
      setError("Upload one floor plan at a time.");
      return;
    }

    const droppedFile = event.dataTransfer.files.item(0);
    if (droppedFile) processFile(droppedFile);
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.currentTarget.files?.item(0);
    event.currentTarget.value = "";

    if (selectedFile) processFile(selectedFile);
  };

  const phaseLabel = {
    idle: "Waiting for a floor plan",
    reading: "Reading floor plan locally…",
    ready: "Floor plan ready",
    opening: "Opening workspace…",
  }[phase];

  return (
    <div className="upload">
      {phase === "idle" ? (
        <div
          className={`dropzone ${isDragging ? "is-dragging" : ""} ${
            !isAuthReady || !isSignedIn ? "is-disabled" : ""
          }`}
          role="button"
          tabIndex={0}
          aria-label={
            !isAuthReady
              ? "Checking Puter sign-in"
              : isSignedIn
              ? "Choose a JPG or PNG floor plan"
              : "Sign in with Puter to upload a floor plan"
          }
          aria-describedby={`${helpId}${error ? ` ${errorId}` : ""}`}
          onClick={(event) => {
            if (event.target !== inputRef.current) activateDropzone();
          }}
          onKeyDown={handleKeyDown}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            ref={inputRef}
            type="file"
            className="drop-input"
            accept={FLOOR_PLAN_ACCEPT_ATTRIBUTE}
            aria-label="Floor plan image"
            tabIndex={-1}
            disabled={!isSignedIn}
            onChange={handleChange}
          />

          <div className="drop-content">
            <div className="drop-icon" aria-hidden="true">
              <UploadIcon size={20} />
            </div>
            <p>
              {!isAuthReady
                ? "Checking sign-in…"
                : isSignedIn
                ? "Click to upload or drag and drop"
                : isSigningIn
                  ? "Opening Puter sign-in…"
                  : "Sign in with Puter to upload"}
            </p>
            <p className="help" id={helpId}>
              JPG or PNG · Maximum file size 10 MB
            </p>
          </div>
        </div>
      ) : (
        <div className="upload-status" aria-live="polite" aria-busy={phase === "reading"}>
          <div className="status-content">
            <div className="status-icon" aria-hidden="true">
              {progress === 100 ? (
                <CheckCircle2 className="check" />
              ) : (
                <ImageIcon className="image" />
              )}
            </div>

            <h3 title={file?.name}>{file?.name}</h3>
            {file && <p className="file-meta">{formatFileSize(file.size)}</p>}

            <div
              className="progress"
              role="progressbar"
              aria-label="Floor plan read progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
            >
              <div className="bar" style={{ width: `${progress}%` }} />
            </div>
            <p className="status-text" role="status">{phaseLabel}</p>

            {phase !== "opening" && (
              <button className="upload-reset" type="button" onClick={resetSelection}>
                Choose another file
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <p className="upload-error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
};

export default Upload;
