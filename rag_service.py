import os
import subprocess
import tempfile
import uuid
from functools import lru_cache
from pathlib import Path

from langchain_community.document_loaders import PyPDFLoader
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_core.documents import Document as LangChainDocument
from langchain_text_splitters import RecursiveCharacterTextSplitter
from sqlalchemy import select

from dotenv import load_dotenv
from models import DocumentChunk, RagDocument, get_db_session

load_dotenv()

EMBED_MODEL = os.getenv("EMBED_MODEL", "all-MiniLM-L6-v2")
CHUNK_SIZE = int(os.getenv("RAG_CHUNK_SIZE", "900"))
CHUNK_OVERLAP = int(os.getenv("RAG_CHUNK_OVERLAP", "180"))


@lru_cache(maxsize=1)
def get_embeddings():
    return HuggingFaceEmbeddings(model_name=EMBED_MODEL)


def _text_splitter():
    return RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
    )


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


def persist_chunks_from_pdf_path(
    pdf_path: str | Path,
    session_id: str,
    user_id: int,
) -> None:
    """Extract, embed, and atomically replace one session's chunks in Neon."""
    path = Path(pdf_path).resolve()
    documents = _load_pdf_documents(path)
    docs = [
        doc
        for doc in _text_splitter().split_documents(documents)
        if doc.page_content.strip()
    ]

    if not docs:
        raise ValueError(
            "No extractable text found in this PDF, even after OCR. The document "
            "may be blank, corrupted, or too low-quality to read."
        )

    texts = [doc.page_content.strip() for doc in docs]
    vectors = get_embeddings().embed_documents(texts)
    sid = uuid.UUID(session_id)
    db = get_db_session()

    try:
        document = (
            db.query(RagDocument)
            .filter(
                RagDocument.session_id == sid,
                RagDocument.user_id == user_id,
            )
            .one_or_none()
        )
        if document is None:
            raise ValueError("Upload record no longer exists.")

        db.query(DocumentChunk).filter(
            DocumentChunk.document_id == document.id
        ).delete(synchronize_session=False)

        db.add_all(
            [
                DocumentChunk(
                    document_id=document.id,
                    chunk_index=index,
                    page_number=doc.metadata.get("page"),
                    content=text,
                    embedding=vector,
                )
                for index, (doc, text, vector) in enumerate(
                    zip(docs, texts, vectors)
                )
            ]
        )
        document.status = "done"
        document.error_message = None
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


class NeonRetriever:
    """LangChain-compatible retriever backed by a pgvector cosine query."""

    def __init__(self, session_id: str, user_id: int, top_k: int) -> None:
        self.session_id = uuid.UUID(session_id)
        self.user_id = user_id
        self.top_k = top_k

    def invoke(self, query: str) -> list[LangChainDocument]:
        query_vector = get_embeddings().embed_query(query)
        distance = DocumentChunk.embedding.cosine_distance(query_vector)
        statement = (
            select(DocumentChunk)
            .join(RagDocument, DocumentChunk.document_id == RagDocument.id)
            .where(
                RagDocument.session_id == self.session_id,
                RagDocument.user_id == self.user_id,
                RagDocument.status == "done",
            )
            .order_by(distance)
            .limit(self.top_k)
        )

        db = get_db_session()
        try:
            chunks = db.execute(statement).scalars().all()
            return [
                LangChainDocument(
                    page_content=chunk.content,
                    metadata={
                        "page": chunk.page_number,
                        "chunk_index": chunk.chunk_index,
                    },
                )
                for chunk in chunks
            ]
        finally:
            db.close()


def neon_retriever(session_id: str, user_id: int) -> NeonRetriever:
    top_k = max(1, int(os.getenv("RAG_TOP_K", "12")))
    return NeonRetriever(session_id=session_id, user_id=user_id, top_k=top_k)


def new_session_id() -> str:
    return str(uuid.uuid4())
