import asyncio
import os
import subprocess
import tempfile
import uuid
from functools import lru_cache
from pathlib import Path

from langchain_community.document_loaders import PyPDFLoader
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS
from langchain_text_splitters import RecursiveCharacterTextSplitter

from dotenv import load_dotenv

load_dotenv()

VECTORSTORE_ROOT = Path(os.getenv("VECTORSTORE_ROOT", "data/vectorstores"))

EMBED_MODEL = os.getenv("EMBED_MODEL", "all-MiniLM-L6-v2")
CHUNK_SIZE = int(os.getenv("RAG_CHUNK_SIZE", "900"))
CHUNK_OVERLAP = int(os.getenv("RAG_CHUNK_OVERLAP", "180"))

_session_upload_locks: dict[str, asyncio.Lock] = {}


def upload_lock(session_id: str) -> asyncio.Lock:
    if session_id not in _session_upload_locks:
        _session_upload_locks[session_id] = asyncio.Lock()
    return _session_upload_locks[session_id]


@lru_cache(maxsize=1)
def get_embeddings():
    return HuggingFaceEmbeddings(model_name=EMBED_MODEL)


def _text_splitter():
    return RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
    )


def faiss_dir_for_session(session_id: str) -> Path:
    return VECTORSTORE_ROOT / session_id / "faiss"


def _load_pdf_documents(path: Path) -> list:
    """Load a PDF's text, falling back to OCR for scanned/image-only documents."""
    documents = PyPDFLoader(str(path)).load()
    if any(d.page_content.strip() for d in documents):
        return documents

    # No extractable text — likely a scanned/image-only PDF. Add a text layer via OCR.
    ocr_path = _ocr_pdf(path)
    if ocr_path is None:
        return documents
    return PyPDFLoader(str(ocr_path)).load()


def _ocr_pdf(path: Path) -> Path | None:
    """Run ocrmypdf to add a text layer. Returns the OCR'd path, or None on failure."""
    out_path = Path(tempfile.gettempdir()) / f"ocr-{uuid.uuid4().hex}.pdf"
    try:
        subprocess.run(
            ["ocrmypdf", "--force-ocr", "--quiet", str(path), str(out_path)],
            check=True,
            capture_output=True,
        )
        return out_path
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


def persist_faiss_from_pdf_path(pdf_path: str | Path, session_id: str) -> Path:
    invalidate_faiss_cache(session_id)
    path = Path(pdf_path).resolve()
    documents = _load_pdf_documents(path)
    docs = _text_splitter().split_documents(documents)

    if not docs or all(not d.page_content.strip() for d in docs):
        raise ValueError(
            "No extractable text found in this PDF, even after OCR. The document "
            "may be blank, corrupted, or too low-quality to read."
        )

    VECTORSTORE_ROOT.mkdir(parents=True, exist_ok=True)
    out_dir = faiss_dir_for_session(session_id)
    if out_dir.exists():
        # Clean previous partial run
        for child in out_dir.iterdir():
            if child.is_file():
                child.unlink()
    else:
        out_dir.mkdir(parents=True)

    embeddings = get_embeddings()
    vectorstore = FAISS.from_documents(docs, embeddings)
    vectorstore.save_local(str(out_dir))
    _VECTOR_CACHE[session_id] = vectorstore
    return out_dir


def load_faiss(session_id: str) -> FAISS | None:
    out_dir = faiss_dir_for_session(session_id)
    if not out_dir.exists():
        return None
    embeddings = get_embeddings()
    return FAISS.load_local(
        str(out_dir),
        embeddings,
        allow_dangerous_deserialization=True,
    )


_VECTOR_CACHE: dict[str, FAISS] = {}


def get_cached_faiss(session_id: str) -> FAISS | None:
    if session_id in _VECTOR_CACHE:
        return _VECTOR_CACHE[session_id]
    store = load_faiss(session_id)
    if store is not None:
        _VECTOR_CACHE[session_id] = store
    return store


def invalidate_faiss_cache(session_id: str) -> None:
    _VECTOR_CACHE.pop(session_id, None)


def rag_retriever(vectorstore: FAISS):
    """Similarity retrieval; k is tunable via RAG_TOP_K (default richer than LangChain defaults)."""
    k = max(1, int(os.getenv("RAG_TOP_K", "12")))
    return vectorstore.as_retriever(
        search_type="similarity",
        search_kwargs={"k": k},
    )


def new_session_id() -> str:
    return str(uuid.uuid4())
