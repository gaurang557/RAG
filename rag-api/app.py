import asyncio
import logging
import os
import re
import tempfile
import uuid
from collections import OrderedDict
from pathlib import Path

from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, Request, UploadFile, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pydantic import BaseModel, Field
from starlette.middleware.sessions import SessionMiddleware
from sqlalchemy.orm import Session

from ask import ask_question
from auth import authenticate_user, get_password_hash
from models import get_db_session, RagDocument, User
from rag_service import (
    neon_retriever,
    new_session_id,
    persist_chunks_from_pdf_path,
)

load_dotenv()

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger(__name__)

SID_KEY = "rag_sid"

SESSION_SECRET_KEY = os.getenv("SESSION_SECRET_KEY")
if not SESSION_SECRET_KEY:
    SESSION_SECRET_KEY = "dev-insecure-change-me-set-SESSION_SECRET_KEY"
    logger.warning(
        "SESSION_SECRET_KEY missing; using insecure default — set SESSION_SECRET_KEY in production."
    )

MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "50"))
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024
MAX_QUESTION_LEN = 2000

app = FastAPI(title="RAG API", version="1.0.0")
security = HTTPBasic()


# ─── INPUT SANITIZATION ────────────────────────────────────────────────────────

_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _sanitize_text(text: str, max_len: int = MAX_QUESTION_LEN) -> str:
    return _CONTROL_RE.sub("", text).strip()[:max_len]


# ─── QUERY CACHE (LRU) ─────────────────────────────────────────────────────────

_MAX_QUERY_CACHE = int(os.getenv("MAX_QUERY_CACHE", "200"))


class _LRUCache:
    def __init__(self, maxsize: int) -> None:
        self._data: OrderedDict[tuple, str] = OrderedDict()
        self._maxsize = maxsize

    def get(self, key: tuple) -> str | None:
        if key not in self._data:
            return None
        self._data.move_to_end(key)
        return self._data[key]

    def put(self, key: tuple, value: str) -> None:
        if key in self._data:
            self._data.move_to_end(key)
        self._data[key] = value
        if len(self._data) > self._maxsize:
            self._data.popitem(last=False)

    def clear_session(self, session_id: str) -> None:
        for k in [k for k in list(self._data) if k[0] == session_id]:
            del self._data[k]


_query_cache = _LRUCache(_MAX_QUERY_CACHE)


async def _ingest_pdf_bg(tmp_path: Path, sid: str, user_id: int) -> None:
    loop = asyncio.get_running_loop()
    try:
        await loop.run_in_executor(
            None,
            persist_chunks_from_pdf_path,
            tmp_path,
            sid,
            user_id,
        )
        logger.info("Background ingest complete for session %s", sid)
    except Exception as e:
        logger.exception("Background ingest failed for session %s", sid)
        db = get_db_session()
        try:
            document = (
                db.query(RagDocument)
                .filter(
                    RagDocument.session_id == uuid.UUID(sid),
                    RagDocument.user_id == user_id,
                )
                .one_or_none()
            )
            if document is not None:
                document.status = "error"
                document.error_message = f"Ingest failed: {e!s}"[:1000]
                db.commit()
        except Exception:
            db.rollback()
            logger.exception("Failed to persist upload error for session %s", sid)
        finally:
            db.close()
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass


# ─── CORS ──────────────────────────────────────────────────────────────────────

def _cors_settings() -> tuple[list[str], bool]:
    raw = ((os.getenv("CORS_ALLOW_ORIGINS") if os.getenv("ENVIRONMENT")  == "Production" else "") or "").strip()
    
    if raw == "*":
        return ["*"], False
    if raw:
        return [x.strip() for x in raw.split(",") if x.strip()], True
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

app.add_middleware(
    SessionMiddleware, 
    secret_key=SESSION_SECRET_KEY,
    session_cookie="rag_session",
    https_only=True,
    same_site="lax"
)


# ─── GLOBAL EXCEPTION HANDLER ──────────────────────────────────────────────────

@app.exception_handler(Exception)
async def _unhandled_exc_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "An unexpected error occurred. Please try again."},
    )


# ─── HELPERS ───────────────────────────────────────────────────────────────────

def ensure_session_id(session: dict) -> str:
    sid = session.get(SID_KEY)
    if not sid:
        sid = new_session_id()
        session[SID_KEY] = sid
    return sid


def get_db():
    db = get_db_session()
    try:
        yield db
    finally:
        db.close()


def get_current_user(credentials: HTTPBasicCredentials = Depends(security), db: Session = Depends(get_db)):
    user = authenticate_user(db, credentials.username, credentials.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Basic"},
        )
    return user


# ─── REQUEST MODELS ────────────────────────────────────────────────────────────

class AskBody(BaseModel):
    question: str = Field(..., min_length=1, max_length=MAX_QUESTION_LEN)


class SignupBody(BaseModel):
    username: str = Field(..., min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9_-]+$")
    password: str = Field(..., min_length=6, max_length=100)


# ─── ENDPOINTS ─────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/signup")
async def signup(body: SignupBody, db: Session = Depends(get_db)):
    existing_user = db.query(User).filter(User.username == body.username).first()
    if existing_user:
        raise HTTPException(status_code=409, detail="Username already exists.")

    hashed_password = get_password_hash(body.password)
    new_user = User(username=body.username, hashed_password=hashed_password)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    return {"message": "User created successfully", "username": new_user.username, "id": new_user.id}


@app.get("/session")
async def session_info(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sid = ensure_session_id(request.session)
    document = (
        db.query(RagDocument)
        .filter(
            RagDocument.session_id == uuid.UUID(sid),
            RagDocument.user_id == current_user.id,
        )
        .one_or_none()
    )
    upload_status = document.status if document is not None else None
    return {
        "session_id": sid,
        "authenticated": True,
        "indexed": upload_status == "done",
        "upload_pending": upload_status == "pending",
        "upload_error": (
            document.error_message
            if document is not None and upload_status == "error"
            else None
        ),
        "username": current_user.username,
    }


@app.post("/upload")
async def upload_pdf(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sid = ensure_session_id(request.session)
    sid_uuid = uuid.UUID(sid)

    fname = file.filename or ""
    if not fname.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF uploads are supported.")

    document = (
        db.query(RagDocument)
        .filter(
            RagDocument.session_id == sid_uuid,
            RagDocument.user_id == current_user.id,
        )
        .one_or_none()
    )
    if document is not None and document.status == "pending":
        raise HTTPException(
            status_code=409, detail="A document is already being processed. Please wait."
        )

    content = await file.read()

    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum allowed size is {MAX_UPLOAD_MB} MB.",
        )

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    tmp_path.write_bytes(content)

    _query_cache.clear_session(sid)
    if document is None:
        document = RagDocument(
            session_id=sid_uuid,
            user_id=current_user.id,
            filename=fname,
            status="pending",
        )
        db.add(document)
    else:
        document.filename = fname
        document.status = "pending"
        document.error_message = None
    db.commit()

    background_tasks.add_task(_ingest_pdf_bg, tmp_path, sid, current_user.id)

    return {
        "ok": True,
        "processing": True,
        "indexed": False,
        "authenticated": True,
        "username": current_user.username,
    }


@app.post("/ask")
async def ask(
    request: Request,
    body: AskBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sid = ensure_session_id(request.session)
    document = (
        db.query(RagDocument)
        .filter(
            RagDocument.session_id == uuid.UUID(sid),
            RagDocument.user_id == current_user.id,
        )
        .one_or_none()
    )
    upload_status = document.status if document is not None else None

    if upload_status == "pending":
        raise HTTPException(status_code=409, detail="Document is still being processed. Please wait.")

    if upload_status == "error":
        raise HTTPException(
            status_code=400,
            detail=document.error_message or "Document processing failed.",
        )

    if document is None or upload_status != "done":
        raise HTTPException(
            status_code=400,
            detail="Upload a PDF first; embeddings will be computed at upload time.",
        )

    sanitized_q = _sanitize_text(body.question)
    if not sanitized_q:
        raise HTTPException(status_code=400, detail="Question cannot be empty after sanitization.")

    cache_key = (sid, sanitized_q.lower())
    cached_answer = _query_cache.get(cache_key)
    if cached_answer is not None:
        return {
            "answer": cached_answer,
            "authenticated": True,
            "username": current_user.username,
            "cached": True,
        }

    retriever = neon_retriever(sid, current_user.id)

    try:
        answer = ask_question(sanitized_q, retriever)
    except TimeoutError:
        logger.warning("LLM timeout for session %s", sid)
        raise HTTPException(
            status_code=504,
            detail="The AI model took too long to respond. Please try again.",
        )
    except Exception as e:
        logger.exception("Ask failed for session %s", sid)
        raise HTTPException(status_code=502, detail="Failed to get an answer. Please try again.") from e

    _query_cache.put(cache_key, answer)

    return {
        "answer": answer,
        "authenticated": True,
        "username": current_user.username,
        "cached": False,
    }


@app.post("/new-session")
async def create_new_session(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    old_sid = request.session.get(SID_KEY)
    if old_sid:
        _query_cache.clear_session(old_sid)
        document = (
            db.query(RagDocument)
            .filter(
                RagDocument.session_id == uuid.UUID(old_sid),
                RagDocument.user_id == current_user.id,
            )
            .one_or_none()
        )
        if document is not None:
            db.delete(document)
            db.commit()

    request.session.clear()
    new_sid = new_session_id()
    request.session[SID_KEY] = new_sid

    return {
        "session_id": new_sid,
        "authenticated": True,
        "indexed": False,
        "username": current_user.username,
    }
