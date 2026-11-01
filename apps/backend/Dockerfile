# Build from the monorepo root:  docker build -f apps/backend/Dockerfile .
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONPATH=/workspace/packages \
    NTN_DATASET_DIR=/data/datasets

WORKDIR /workspace/apps/backend

COPY apps/backend/requirements.txt .
# CPU-only PyTorch keeps the image small; requirements.txt is then already satisfied for torch.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r requirements.txt

COPY packages /workspace/packages
# TLE files baked into the image for cloud deployment (docker-compose mounts ./6G_Datasets over this)
COPY 6G_Datasets/*.tle /data/datasets/
COPY apps/backend/app ./app

ENV PORT=8000
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD python -c "import urllib.request;urllib.request.urlopen('http://localhost:8000/api/health')" || exit 1
# cloud hosts inject $PORT; locally it stays 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
