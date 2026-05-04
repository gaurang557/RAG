import logging
import os
import tempfile
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Request, UploadFile, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pydantic import BaseModel, Field
from starlette.middleware.sessions import SessionMiddleware
from sqlalchemy.orm import Session

from ask import ask_question
from auth import authenticate_user, decode_basic_auth, create_default_user, get_password_hash
from models import get_db_session, User
from rag_service import (
    get_cached_faiss,
    invalidate_faiss_cache,
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

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@localhost/rag_db")

app = FastAPI(title="RAG API", version="1.0.0")
security = HTTPBasic()


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


def get_db():
    db = get_db_session(DATABASE_URL)
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


class AskBody(BaseModel):
    question: str = Field(..., min_length=1)


class SignupBody(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=6, max_length=100)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/signup")
async def signup(body: SignupBody, db: Session = Depends(get_db)):
    existing_user = db.query(User).filter(User.username == body.username).first()
    if existing_user:
        raise HTTPException(
            status_code=409,
            detail="Username already exists"
        )
    
    hashed_password = get_password_hash(body.password)
    new_user = User(username=body.username, hashed_password=hashed_password)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    return {
        "message": "User created successfully",
        "username": new_user.username,
        "id": new_user.id
    }


@app.get("/session")
async def session_info(request: Request, current_user: User = Depends(get_current_user)):
    sid = ensure_session_id(request.session)
    return {
        "session_id": sid,
        "authenticated": True,
        "indexed": bool(request.session.get(UPLOAD_DONE_KEY)),
        "username": current_user.username,
    }


@app.post("/upload")
async def upload_pdf(request: Request, file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
    sid = ensure_session_id(request.session)

    
    fname = file.filename or ""
    if not fname.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail="Only PDF uploads are supported.",
        )

    async with upload_lock(sid):

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
        "authenticated": True,
        "username": current_user.username,
    }


@app.post("/ask")
async def ask(request: Request, body: AskBody, current_user: User = Depends(get_current_user)):
    sid = ensure_session_id(request.session)

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
        "authenticated": True,
        "username": current_user.username,
    }


@app.post("/new-session")
async def create_new_session(request: Request, current_user: User = Depends(get_current_user)):
    old_sid = request.session.get(SID_KEY)
    if old_sid:
        invalidate_faiss_cache(old_sid)
        
        from rag_service import faiss_dir_for_session
        import shutil
        old_dir = faiss_dir_for_session(old_sid)
        if old_dir.exists():
            shutil.rmtree(old_dir, ignore_errors=True)
    
    request.session.clear()
    new_sid = new_session_id()
    request.session[SID_KEY] = new_sid
    
    return {
        "session_id": new_sid,
        "authenticated": True,
        "indexed": False,
        "username": current_user.username,
    }
