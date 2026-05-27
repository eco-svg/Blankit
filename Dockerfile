FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    libopenblas0 \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN grep -v "llama-cpp-python" requirements.txt > /tmp/req_no_llama.txt && \
    pip install --no-cache-dir -r /tmp/req_no_llama.txt

RUN pip install --no-cache-dir llama-cpp-python \
    --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu

COPY . .

# Download WebLLM bundle at build time (too large for git without LFS)
RUN curl -fsSL "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.83/lib/index.js" \
    -o distro/pug/static/webllm.js

EXPOSE 7860

CMD ["gunicorn", "--bind", "0.0.0.0:7860", "--workers", "2", "--threads", "4", "--worker-class", "gthread", "--timeout", "120", "--access-logfile", "-", "app:create_app()"]
