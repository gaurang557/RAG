import logging
import os
import tempfile
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from starlette.middleware.sessions import SessionMiddleware

from ask import ask_question
from rag_service import (
    get_cached_faiss,
    new_session_id,
    persist_faiss_from_pdf_path,
    rag_retriever,
    upload_lock,
)

load_dotenv()

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger(__name__)

SID_KEY = "rag_sid"
UPLOAD_DONE_KEY = "rag_upload_done"

SESSION_SECRET_KEY = os.getenv("SESSION_SECRET_KEY")
if not SESSION_SECRET_KEY:
    SESSION_SECRET_KEY = "dev-insecure-change-me-set-SESSION_SECRET_KEY"
    logger.warning(
        "SESSION_SECRET_KEY missing; using insecure default — set SESSION_SECRET_KEY in production."
    )

app = FastAPI(title="RAG API", version="1.0.0")


def _cors_settings() -> tuple[list[str], bool]:
    """
    Cookie sessions need allow_credentials=True and non-wildcard Allow-Origin in browsers.
    Use CORS_ALLOW_ORIGINS=* for tooling-only setups (omit credentials).
    """
    raw = (os.getenv("CORS_ALLOW_ORIGINS") or "").strip()
    if raw == "*":
        return ["*"], False
    if raw:
        return [x.strip() for x in raw.split(",") if x.strip()], True
    # Sensible SPA dev defaults; adjust via CORS_ALLOW_ORIGINS when needed.
    return [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:4200",
        "http://127.0.0.1:4200",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ], True


_ORIGINS, _CREDENTIALS = _cors_settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ORIGINS,
    allow_credentials=_CREDENTIALS,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.add_middleware(SessionMiddleware, secret_key=SESSION_SECRET_KEY, session_cookie="rag_session")


def ensure_session_id(session: dict) -> str:
    sid = session.get(SID_KEY)
    if not sid:
        sid = new_session_id()
        session[SID_KEY] = sid
    return sid


def update_auth_state(request: Request) -> None:
    auth_header = (
        request.headers.get("authorization")
        or request.headers.get("Authorization")
        or ""
    )
    bearer = ""
    if auth_header.startswith("Bearer "):
        bearer = auth_header[7:].strip()

    api_token = os.getenv("API_ACCESS_TOKEN")
    if bearer and api_token:
        request.session["authenticated"] = bearer == api_token
    elif bearer:
        request.session["authenticated"] = True
    else:
        request.session["authenticated"] = False


class AskBody(BaseModel):
    question: str = Field(..., min_length=1)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/session")
async def session_info(request: Request):
    update_auth_state(request)
    sid = ensure_session_id(request.session)
    return {
        "session_id": sid,
        "authenticated": bool(request.session.get("authenticated")),
        "indexed": bool(request.session.get(UPLOAD_DONE_KEY)),
    }


@app.post("/upload")
async def upload_pdf(request: Request, file: UploadFile = File(...)):
    sid = ensure_session_id(request.session)
    update_auth_state(request)

    if request.session.get(UPLOAD_DONE_KEY):
        raise HTTPException(
            status_code=409,
            detail="This session already has an indexed document (one upload per session).",
        )

    fname = file.filename or ""
    if not fname.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail="Only PDF uploads are supported.",
        )

    async with upload_lock(sid):
        if request.session.get(UPLOAD_DONE_KEY):
            raise HTTPException(
                status_code=409,
                detail="This session already has an indexed document (one upload per session).",
            )

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp_path = Path(tmp.name)

        try:
            content = await file.read()
            tmp_path.write_bytes(content)
            persist_faiss_from_pdf_path(tmp_path, sid)
        except Exception as e:
            logger.exception("Ingest failed")
            raise HTTPException(status_code=500, detail=f"Ingest failed: {e!s}") from e
        finally:
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass

        request.session[UPLOAD_DONE_KEY] = True

    return {
        "ok": True,
        "indexed": True,
        "authenticated": bool(request.session.get("authenticated")),
    }


@app.post("/ask")
async def ask(request: Request, body: AskBody):
    sid = ensure_session_id(request.session)
    update_auth_state(request)

    if not request.session.get(UPLOAD_DONE_KEY):
        raise HTTPException(
            status_code=400,
            detail="Upload a PDF first (one per session); embeddings will be computed at upload time.",
        )

    vectorstore = get_cached_faiss(sid)
    if vectorstore is None:
        raise HTTPException(
            status_code=404,
            detail="Indexed store not found on disk for this session; upload again.",
        )

    retriever = rag_retriever(vectorstore)

    try:
        answer = ask_question(body.question, retriever)
    except Exception as e:
        logger.exception("Ask failed")
        raise HTTPException(status_code=502, detail=str(e)) from e

    return {
        "answer": answer,
        "authenticated": bool(request.session.get("authenticated")),
    }
