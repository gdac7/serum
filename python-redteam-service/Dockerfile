FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        git curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# torch's cu126 wheels bundle their own CUDA runtime, so the image needs no CUDA
# base — only the host driver and nvidia-container-toolkit.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server/ server/
COPY src/ src/
COPY configs/ configs/

ENV PYTHONUNBUFFERED=1 \
    HF_HOME=/weights

EXPOSE 8080

CMD ["uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "8080"]
