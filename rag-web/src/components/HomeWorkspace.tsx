"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import rehypeKatex from "rehype-katex";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { useAuth } from "@/context/AuthContext";
import { api, type SessionInfo } from "@/lib/api";
import { ApiError, httpErrorDetail } from "@/lib/apiError";
import "../app/styles/home.scss";

interface ChatMessage {
  type: "user" | "ai";
  content: string;
  isError?: boolean;
}

function normalizeMathDelimiters(markdown: string): string {
  return markdown
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, math: string) => {
      return `\n\n$$\n${math.trim()}\n$$\n\n`;
    })
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, math: string) => {
      return `$${math.trim()}$`;
    });
}

function MarkdownAnswer({ content }: { content: string }) {
  return (
    <div className="bubble-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
        }}
      >
        {normalizeMathDelimiters(content)}
      </ReactMarkdown>
    </div>
  );
}

const MAX_FILE_MB = 50;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
const MAX_QUESTION_LEN = 2000;
const POLL_INTERVAL_MS = 1500;

export function HomeWorkspace() {
  const router = useRouter();
  const { logout: authLogout } = useAuth();

  const [session, setSession] = useState<SessionInfo | null>(null);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadProcessing, setUploadProcessing] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [askBusy, setAskBusy] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);

  const [isDragging, setIsDragging] = useState(false);
  const [question, setQuestion] = useState("");
  const [chosenFileMeta, setChosenFileMeta] = useState<{ name: string; size: number } | null>(
    null,
  );

  const pendingFile = useRef<File | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileChooser = useRef<HTMLInputElement>(null);
  const chatScroll = useRef<HTMLDivElement>(null);

  // Re-entrancy guards (kept in refs so they stay accurate inside async callbacks).
  const sessionBusyRef = useRef(false);
  const uploadInFlightRef = useRef(false);
  const askBusyRef = useRef(false);

  const username = session?.username ?? "";
  const userInitial = username.charAt(0).toUpperCase() || "?";
  const questionTooLong = question.length > MAX_QUESTION_LEN;

  const shortenId = (id: string): string =>
    id.length <= 14 ? id : `${id.slice(0, 6)}…${id.slice(-6)}`;

  const clearPoll = useCallback(() => {
    if (pollTimer.current !== null) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      const el = chatScroll.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, 0);
  }, []);

  const refreshSession = useCallback(() => {
    if (sessionBusyRef.current) return;
    sessionBusyRef.current = true;
    setSessionBusy(true);
    setSessionError(null);
    api
      .session()
      .then((s) => setSession(s))
      .catch((e: unknown) => {
        setSession(null);
        setSessionError(httpErrorDetail(e));
        if (e instanceof ApiError && e.status === 401) {
          authLogout();
          router.push("/login");
        }
      })
      .finally(() => {
        sessionBusyRef.current = false;
        setSessionBusy(false);
      });
  }, [authLogout, router]);

  // Mount: load session. Unmount: stop polling.
  useEffect(() => {
    refreshSession();
    return () => clearPoll();
  }, [refreshSession, clearPoll]);

  const logout = useCallback(() => {
    clearPoll();
    authLogout();
    router.push("/login");
  }, [clearPoll, authLogout, router]);

  const createNewSession = useCallback(() => {
    if (sessionBusyRef.current) return;
    clearPoll();
    sessionBusyRef.current = true;
    setSessionBusy(true);
    api
      .newSession()
      .then((s) => {
        setSession(s);
        setUploadSuccess(false);
        setUploadError(null);
        setUploadProcessing(false);
        setChosenFileMeta(null);
        pendingFile.current = null;
        setChatHistory([]);
      })
      .catch((e: unknown) => setSessionError(httpErrorDetail(e)))
      .finally(() => {
        sessionBusyRef.current = false;
        setSessionBusy(false);
      });
  }, [clearPoll]);

  const triggerFileChooser = useCallback(() => {
    fileChooser.current?.click();
  }, []);

  const validateFile = (f: File): string | null => {
    if (!f.name.toLowerCase().endsWith(".pdf")) {
      return "Only PDF files are supported.";
    }
    if (f.size === 0) {
      return "The selected file is empty.";
    }
    if (f.size > MAX_FILE_BYTES) {
      return `File is too large. Maximum size is ${MAX_FILE_MB} MB.`;
    }
    return null;
  };

  const onFilePicked = (ev: ChangeEvent<HTMLInputElement>) => {
    const input = ev.target;
    const f = input.files?.[0];
    if (!f) return;

    const err = validateFile(f);
    if (err) {
      setUploadError(err);
      pendingFile.current = null;
      setChosenFileMeta(null);
      input.value = "";
      return;
    }
    setUploadError(null);
    setUploadSuccess(false);
    pendingFile.current = f;
    setChosenFileMeta({ name: f.name, size: f.size });
  };

  const onDragOver = (ev: DragEvent) => {
    ev.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => setIsDragging(false);

  const onDrop = (ev: DragEvent) => {
    ev.preventDefault();
    setIsDragging(false);
    const f = ev.dataTransfer?.files?.[0];
    if (!f) return;

    const err = validateFile(f);
    if (err) {
      setUploadError(err);
      return;
    }
    setUploadError(null);
    setUploadSuccess(false);
    pendingFile.current = f;
    setChosenFileMeta({ name: f.name, size: f.size });
  };

  const clearChosenFile = () => {
    if (fileChooser.current) fileChooser.current.value = "";
    pendingFile.current = null;
    setChosenFileMeta(null);
    setUploadError(null);
  };

  const startPolling = useCallback(() => {
    const check = () => {
      api
        .session()
        .then((s) => {
          setSession(s);
          if (s.indexed) {
            setUploadProcessing(false);
            setUploadSuccess(true);
            setChatHistory([]);
          } else if (s.upload_pending) {
            pollTimer.current = setTimeout(check, POLL_INTERVAL_MS);
          } else if (s.upload_error) {
            setUploadProcessing(false);
            setUploadError(s.upload_error);
          } else {
            pollTimer.current = setTimeout(check, POLL_INTERVAL_MS);
          }
        })
        .catch(() => {
          setUploadProcessing(false);
          setUploadError("Failed to check processing status. Please try uploading again.");
        });
    };
    pollTimer.current = setTimeout(check, POLL_INTERVAL_MS);
  }, []);

  const upload = useCallback(() => {
    const file = pendingFile.current;
    if (!file || uploadInFlightRef.current || uploadProcessing) return;

    uploadInFlightRef.current = true;
    setUploadBusy(true);
    setUploadError(null);
    clearPoll();

    api
      .uploadPdf(file)
      .then((r) => {
        if (r.processing) {
          setUploadProcessing(true);
          setUploadSuccess(false);
          startPolling();
        } else {
          setUploadSuccess(true);
          setUploadProcessing(false);
          setChatHistory([]);
          refreshSession();
        }
      })
      .catch((e: unknown) => {
        setUploadError(httpErrorDetail(e));
        setUploadSuccess(false);
        setUploadProcessing(false);
      })
      .finally(() => {
        uploadInFlightRef.current = false;
        setUploadBusy(false);
      });
  }, [uploadProcessing, clearPoll, startPolling, refreshSession]);

  const ask = useCallback(() => {
    const q = question.trim();
    if (!q || askBusyRef.current) return;

    if (q.length > MAX_QUESTION_LEN) {
      setChatHistory((h) => [
        ...h,
        {
          type: "ai",
          content: `Question is too long (max ${MAX_QUESTION_LEN} characters).`,
          isError: true,
        },
      ]);
      return;
    }

    setQuestion("");
    askBusyRef.current = true;
    setAskBusy(true);
    setChatHistory((h) => [...h, { type: "user", content: q }]);
    scrollToBottom();

    api
      .ask(q)
      .then((r) => {
        setChatHistory((h) => [...h, { type: "ai", content: r.answer ?? "" }]);
        scrollToBottom();
      })
      .catch((e: unknown) => {
        setChatHistory((h) => [...h, { type: "ai", content: httpErrorDetail(e), isError: true }]);
        scrollToBottom();
      })
      .finally(() => {
        askBusyRef.current = false;
        setAskBusy(false);
      });
  }, [question, scrollToBottom]);

  const onEnterKey = (ev: KeyboardEvent<HTMLTextAreaElement>) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      ask();
    }
  };

  const uploadDisabled = uploadBusy || uploadProcessing;

  return (
    <div className="workspace">
      {/* ─── HEADER ─────────────────────────────────────────────── */}
      <header className="header">
        <div className="header-brand">
          <div className="brand-icon">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="brand-text">
            <span className="brand-name">RAGStudio</span>
            <span className="brand-tag">Intelligent Document Q&amp;A</span>
          </div>
        </div>

        <div className="header-right">
          {session ? (
            <>
              <div
                className={`session-status${session.indexed ? " active" : ""}${
                  session.upload_pending ? " pending" : ""
                }`}
              >
                <span className="status-dot" />
                <span>
                  {session.upload_pending || uploadProcessing
                    ? "Processing…"
                    : session.indexed
                      ? "Document ready"
                      : "No document"}
                </span>
              </div>
              <div className="divider-v" />
              <div className="user-chip">
                <div className="user-avatar">{userInitial}</div>
                <span className="user-name">{username}</span>
              </div>
              <button
                className="btn-icon-text"
                onClick={createNewSession}
                disabled={sessionBusy || uploadProcessing}
                title="Clear session and start fresh"
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 0 0 4.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 0 1-15.357-2m15.357 2H15"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                New Session
              </button>
            </>
          ) : sessionBusy ? (
            <span className="text-muted">Connecting…</span>
          ) : null}
          <button className="btn-logout" onClick={logout}>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v1"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Logout
          </button>
        </div>
      </header>

      {/* ─── SESSION ERROR BANNER ───────────────────────────────── */}
      {sessionError && (
        <div className="global-error" aria-live="assertive">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {sessionError}
        </div>
      )}

      {/* ─── MAIN WORKSPACE ─────────────────────────────────────── */}
      <main className="workspace-main">
        {/* LEFT: UPLOAD PANEL */}
        <section className="panel upload-panel">
          <div className="panel-header">
            <div className="panel-icon-wrap">
              <svg className="panel-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M4 16v1a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div>
              <h2 className="panel-title">Upload Document</h2>
              <p className="panel-subtitle">
                PDF only · Max {MAX_FILE_MB} MB · Replaces current document
              </p>
            </div>
          </div>

          {/* Hidden file input */}
          <input
            ref={fileChooser}
            type="file"
            accept=".pdf,application/pdf"
            className="sr-only"
            onChange={onFilePicked}
          />

          {/* Drop Zone */}
          <div
            className={`drop-zone${chosenFileMeta ? " has-file" : ""}${
              isDragging ? " drag-over" : ""
            }${uploadDisabled ? " disabled" : ""}`}
            onClick={() => {
              if (!uploadDisabled) triggerFileChooser();
            }}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            role="button"
            tabIndex={0}
            aria-label={chosenFileMeta ? "Change file" : "Select PDF file"}
          >
            {chosenFileMeta ? (
              <div className="drop-zone-content">
                <svg className="dz-icon success" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="file-name">{chosenFileMeta.name}</span>
                <span className="file-size">{chosenFileMeta.size.toLocaleString()} bytes</span>
              </div>
            ) : (
              <div className="drop-zone-content">
                <svg className="dz-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M7 16a4 4 0 0 1-.88-7.903A5 5 0 1 1 15.9 6L16 6a5 5 0 0 1 1 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="dz-label">Drop PDF here or click to browse</span>
                <span className="dz-hint">Max {MAX_FILE_MB} MB · Indexed in background</span>
              </div>
            )}
          </div>

          {/* Upload Actions */}
          <div className="upload-actions">
            {chosenFileMeta && (
              <button
                className="btn-ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  clearChosenFile();
                }}
                disabled={uploadDisabled}
              >
                Clear
              </button>
            )}
            <button
              className="btn-primary"
              onClick={upload}
              disabled={!chosenFileMeta || uploadDisabled}
            >
              {uploadBusy ? (
                <>
                  <svg className="spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                  Uploading…
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M4 16v1a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Index Document
                </>
              )}
            </button>
          </div>

          {/* Processing banner */}
          {uploadProcessing && (
            <div className="status-banner processing" aria-live="polite">
              <svg className="spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              Building search index — this may take a moment…
            </div>
          )}

          {uploadSuccess && !uploadProcessing && (
            <div className="status-banner success">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Document indexed — ready for questions
            </div>
          )}

          {uploadError && (
            <div className="status-banner error">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 8v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {uploadError}
            </div>
          )}

          {/* Session metadata */}
          {session && (
            <div className="session-meta">
              <span className="meta-label">Session</span>
              <code className="session-id" title={session.session_id}>
                {shortenId(session.session_id)}
              </code>
            </div>
          )}
        </section>

        {/* RIGHT: CHAT PANEL */}
        <section className="panel chat-panel">
          <div className="panel-header">
            <div className="panel-icon-wrap">
              <svg className="panel-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 0 1-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div>
              <h2 className="panel-title">Ask Questions</h2>
              <p className="panel-subtitle">Based on your uploaded document</p>
            </div>
          </div>

          {/* Messages */}
          <div className="chat-messages" ref={chatScroll} aria-live="polite">
            {chatHistory.length === 0 && !askBusy && (
              <div className="chat-empty">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <p>Upload a document, then ask anything about it</p>
              </div>
            )}

            {chatHistory.map((msg, i) => (
              <div
                key={i}
                className={`message${msg.type === "user" ? " user-msg" : ""}${
                  msg.type === "ai" ? " ai-msg" : ""
                }`}
              >
                {msg.type === "ai" && (
                  <div className={`ai-avatar${msg.isError ? " error-avatar" : ""}`}>
                    {msg.isError ? (
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                          d="M12 8v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                        />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                          d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </div>
                )}
                <div className={`bubble${msg.isError ? " error-bubble" : ""}`}>
                  {msg.type === "ai" && !msg.isError ? (
                    <MarkdownAnswer content={msg.content} />
                  ) : (
                    <p className="bubble-text">{msg.content}</p>
                  )}
                </div>
              </div>
            ))}

            {askBusy && (
              <div className="message ai-msg">
                <div className="ai-avatar">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <div className="bubble typing">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                </div>
              </div>
            )}
          </div>

          {/* Input Area */}
          <div className="chat-footer">
            <div className="chat-input-row">
              <textarea
                className="chat-input"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask a question about your document… (Enter to send)"
                disabled={askBusy}
                rows={1}
                maxLength={MAX_QUESTION_LEN}
                onKeyDown={onEnterKey}
              />
              <button
                className="btn-send"
                onClick={ask}
                disabled={askBusy || !question.trim() || questionTooLong}
                title="Send (Enter)"
                aria-label="Send message"
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
            <div className="input-footer-row">
              <p className="input-hint">Enter to send · Shift+Enter for new line</p>
              {question.length > MAX_QUESTION_LEN * 0.8 && (
                <span className={`char-count${questionTooLong ? " over-limit" : ""}`}>
                  {question.length}/{MAX_QUESTION_LEN}
                </span>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
