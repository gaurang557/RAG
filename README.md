# RAGStudio — Intelligent Document Q&A

RAGStudio lets you upload a PDF and ask natural-language questions about its contents. It uses Retrieval-Augmented Generation (RAG): your document is chunked, embedded into a FAISS vector store, and relevant passages are retrieved at query time before being sent to an LLM for a grounded answer.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Angular 21 (standalone components, signals) |
| Backend | FastAPI (Python 3.12) |
| Vector store | FAISS + HuggingFace `all-MiniLM-L6-v2` embeddings |
| LLM | Groq API (`llama-3.1-8b-instant` by default) |
| Auth | HTTP Basic Auth + bcrypt; session cookie via Starlette |
| Database | PostgreSQL (SQLAlchemy) — stores user credentials |
| PDF parsing | LangChain `PyPDFLoader` |

---

## Architecture

```
Browser (Angular 21)
  │
  │  HTTP Basic Auth + session cookie
  ▼
FastAPI (app.py)
  ├── POST /signup          — create account (PostgreSQL)
  ├── GET  /session         — auth check + upload status
  ├── POST /upload          — receive PDF → BackgroundTask
  │     └── BackgroundTask: chunk → embed → FAISS (thread pool)
  ├── POST /ask             — sanitize query → cache lookup
  │     ├── LRU cache hit   → return cached answer
  │     └── cache miss      → FAISS retrieval → Groq LLM → cache
  └── POST /new-session     — clear vectorstore + query cache
        │
        ├── rag_service.py  — FAISS per-session, in-memory cache
        ├── ask.py          — prompt construction + sanitization
        └── llm.py          — Groq API call with timeout handling
```

**Data flow for a question:**
1. Frontend sends `POST /ask { question }` with Basic Auth header
2. Backend sanitizes input (strips control chars, enforces 2000-char limit)
3. Checks in-memory LRU cache — returns instantly on hit
4. On miss: retrieves top-K passages from FAISS, builds prompt, calls Groq
5. Stores result in LRU cache; returns answer to client

---

## Setup

### Prerequisites

- Python 3.12+
- Node.js 20+ and npm
- PostgreSQL running locally (or via Docker)
- A [Groq API key](https://console.groq.com/)

### 1. Clone and configure

```bash
git clone <repo-url>
cd RAG
cp .env.example .env   # then edit .env
```

`.env` variables:

```env
# Required
LLM_API_KEY=
DATABASE_URL=postgresql://user:password@localhost/rag_db
SESSION_SECRET_KEY=

# Optional
LLM_MODEL=llama-3.1-8b-instant
EMBED_MODEL=all-MiniLM-L6-v2
VECTORSTORE_ROOT=data/vectorstores
RAG_CHUNK_SIZE=900
RAG_CHUNK_OVERLAP=180
RAG_TOP_K=12
MAX_UPLOAD_MB=50
MAX_QUERY_CACHE=200
LLM_TIMEOUT_SECONDS=30
CORS_ALLOW_ORIGINS=http://localhost:4200
LOG_LEVEL=INFO
```

### 2. Backend

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Create the database and tables
python init_db.py

# Start the API server
python -m uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

The API will be available at `http://localhost:8000`. Interactive docs at `http://localhost:8000/docs`.

### 3. Frontend

```bash
cd rag-ui
npm install
npm start           # dev server at http://localhost:4200
```

For a production build:
```bash
ng build --configuration production
# Serve dist/rag-ui/browser/ with any static file server
```

### 4. Docker (optional)

```bash
docker compose up --build
```

---

## Key Design Decisions

### Background upload processing
PDF ingestion (parsing → chunking → embedding) is CPU-intensive and can take 10–60 seconds for large files. The `/upload` endpoint returns `202 processing: true` immediately; the Angular frontend polls `/session` every 1.5 s until `indexed: true`. This keeps the main thread free.

### LRU query cache
Repeated identical questions (same session, same text) return from an in-memory LRU cache without hitting the vector store or LLM. Cache is invalidated when the session is reset or a new document is uploaded.

### Prompt injection mitigation
- Control characters are stripped from all user inputs server-side.
- The prompt template separates the question from document excerpts with clear labels and includes an explicit rule against overriding instructions.
- Input length is enforced at both Pydantic validation (backend) and `maxlength` (frontend).

### Per-session FAISS stores
Each authenticated session gets its own FAISS index at `data/vectorstores/{session_id}/faiss/`. An in-memory dict caches loaded stores; new sessions clear the old index from disk.

---

## API Reference

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | — | Liveness check |
| POST | `/signup` | — | Create account |
| GET | `/session` | Basic | Auth check + upload status |
| POST | `/upload` | Basic | Upload PDF (returns immediately; indexes in background) |
| POST | `/ask` | Basic | Ask a question about the indexed document |
| POST | `/new-session` | Basic | Clear current document and start fresh |

---

## Project Structure

```
RAG/
├── app.py              # FastAPI routes, middleware, upload jobs, query cache
├── ask.py              # RAG prompt construction + query sanitization
├── auth.py             # bcrypt helpers, Basic Auth decoder
├── llm.py              # Groq API client with timeout/connection error handling
├── models.py           # SQLAlchemy User model
├── rag_service.py      # FAISS create/load/cache per session
├── init_db.py          # Database initialization script
├── .env                # Environment variables (not committed)
└── rag-ui/
    └── src/app/
        ├── auth/       # Login + Signup components + AuthService + guard
        ├── home/       # Main workspace (upload panel + chat panel)
        ├── services/   # RagApiService (HTTP client)
        └── interceptors/ # Adds Basic Auth header + withCredentials to all requests
```
