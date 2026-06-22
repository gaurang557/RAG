FROM python:3.12-slim

WORKDIR /app

# Install dependencies first (cached layer)
COPY requirements.txt .
# Install CPU-only torch first (avoids ~4 GB of CUDA/nvidia wheels), then the rest
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r requirements.txt


# Pre-download the default embedding model so containers start without network calls.
# Override EMBED_MODEL at build time via --build-arg if you use a different model.
ARG EMBED_MODEL=all-MiniLM-L6-v2
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('${EMBED_MODEL}')"

# Copy application source
COPY app.py ask.py auth.py llm.py models.py rag_service.py init_db.py ./

# Persistent storage for per-session FAISS indices (mount a volume here in production)
RUN mkdir -p data/vectorstores

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"

ENTRYPOINT ["/docker-entrypoint.sh"]
