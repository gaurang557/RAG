# RAGStudio — Intelligent Document Q&A

RAGStudio lets you upload a PDF and ask natural-language questions about its contents. It uses Retrieval-Augmented Generation (RAG): your document is chunked, embedded into Neon PostgreSQL with pgvector, and relevant passages are retrieved before being sent to an LLM for a grounded answer.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 + React 19 |
| Backend | FastAPI (Python 3.12) |
| Vector store | Neon PostgreSQL + pgvector with HuggingFace `all-MiniLM-L6-v2` embeddings |
| LLM | Configurable OpenAI-compatible API (Amazon Bedrock Mantle by default) |
| Auth | HTTP Basic Auth + bcrypt; session cookie via Starlette |
| Database | PostgreSQL (SQLAlchemy) — stores user credentials |
| PDF parsing | LangChain `PyPDFLoader` |

---

## Architecture

```
Browser (Next.js 15)
  │
  │  HTTP Basic Auth + session cookie
  ▼
FastAPI (app.py)
  ├── POST /signup          — create account (PostgreSQL)
  ├── GET  /session         — auth check + upload status
  ├── POST /upload          — receive PDF → BackgroundTask
  │     └── BackgroundTask: chunk → embed → pgvector (thread pool)
  ├── POST /ask             — sanitize query → cache lookup
  │     ├── LRU cache hit   → return cached answer
  │     └── cache miss      → pgvector retrieval → Amazon Bedrock → cache
  └── POST /new-session     — clear vectorstore + query cache
        │
        ├── rag_service.py  — PDF ingestion and pgvector retrieval
        ├── ask.py          — prompt construction + sanitization
        └── llm.py          — Provider-neutral OpenAI-compatible LLM adapter
```

**Data flow for a question:**
1. Frontend sends `POST /ask { question }` with Basic Auth header
2. Backend sanitizes input (strips control chars, enforces 2000-char limit)
3. Checks in-memory LRU cache — returns instantly on hit
4. On miss: retrieves top-K passages from pgvector, builds prompt, calls Bedrock
5. Stores result in LRU cache; returns answer to client

---

## Setup

### Prerequisites

- Python 3.12+
- Node.js 20+ and npm
- A Neon PostgreSQL database with the `vector` extension enabled
- An Amazon Bedrock API key, or credentials for another OpenAI-compatible provider

### 1. Clone and configure

```bash
git clone <repo-url>
cd RAG
cp .env.example .env   # then edit .env
```

`.env` variables:

```env
# Required
DATABASE_URL=postgresql://user:password@your-neon-host/rag_db?sslmode=require
SESSION_SECRET_KEY=

# Required LLM configuration (Amazon Bedrock Mantle example)
LLM_API_KEY=your-bedrock-api-key
LLM_BASE_URL=https://bedrock-mantle.ap-south-1.api.aws/v1
LLM_MODEL=your-mantle-model-id

# Optional
LLM_API_STYLE=responses
LLM_MAX_TOKENS=1000
LLM_TIMEOUT_SECONDS=30
# LLM_TEMPERATURE=0.1
EMBED_MODEL=all-MiniLM-L6-v2
RAG_CHUNK_SIZE=900
RAG_CHUNK_OVERLAP=180
RAG_TOP_K=12
MAX_UPLOAD_MB=50
MAX_QUERY_CACHE=200
LLM_TIMEOUT_SECONDS=30
CORS_ALLOW_ORIGINS=http://localhost:4200
LOG_LEVEL=INFO
```

To change providers, update `LLM_API_KEY`, `LLM_BASE_URL`, and `LLM_MODEL`.
No application code changes are required as long as the provider exposes an
OpenAI-compatible API. Use `LLM_API_STYLE=chat_completions` for providers or
models that do not support the Responses API.

For production, store the Bedrock API key in AWS Secrets Manager or another
secret store rather than committing it or baking it into the container image.

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
cd rag-web
npm install
npm run dev         # dev server at http://localhost:3000
```

For a production build:
```bash
npm run build
npm start
```

### 4. Docker (optional)

```bash
docker compose up --build
```

---

## Key Design Decisions

### Background upload processing
PDF ingestion (parsing → chunking → embedding) is CPU-intensive and can take 10–60 seconds for large files. The `/upload` endpoint returns `202 processing: true` immediately; the Next.js frontend polls `/session` until `indexed: true`. This keeps the main thread free.

### LRU query cache
Repeated identical questions (same session, same text) return from an in-memory LRU cache without hitting the vector store or LLM. Cache is invalidated when the session is reset or a new document is uploaded.

### Prompt injection mitigation
- Control characters are stripped from all user inputs server-side.
- The prompt template separates the question from document excerpts with clear labels and includes an explicit rule against overriding instructions.
- Input length is enforced at both Pydantic validation (backend) and `maxlength` (frontend).

### Per-session vector stores
Each authenticated session stores its document chunks and embeddings in Neon. Retrieval filters by both the authenticated user and signed session ID, and new sessions delete the previous document and its chunks.

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
├── llm.py              # Configurable OpenAI-compatible LLM adapter
├── models.py           # SQLAlchemy User model
├── rag_service.py      # pgvector ingestion and similarity retrieval
├── init_db.py          # Database initialization script
├── .env                # Environment variables (not committed)
└── rag-web/
    └── src/
        ├── app/          # Next.js routes and page styles
        ├── components/   # Auth guard and document Q&A workspace
        ├── context/      # Authentication state
        └── lib/          # Credentialed FastAPI client
```
