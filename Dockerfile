FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    libopenblas0 \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN grep -v "llama-cpp-python" requirements.txt > /tmp/req_no_llama.txt && \
    pip install --no-cache-dir -r /tmp/req_no_llama.txt

# llama-cpp-python powers OPTIONAL server-side inference (self-host only). Production
# serves BlinkBot's weights to the browser from B2, so this isn't needed here. The
# import is guarded (_LLAMA_OK), so if the prebuilt CPU wheel isn't available we skip
# it rather than fail the whole deploy by falling back to a source build (no compiler).
RUN pip install --no-cache-dir llama-cpp-python \
    --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu \
    || echo "[build] llama-cpp-python unavailable — skipping (server-side inference disabled)"

COPY . .

# Download WebLLM bundle at build time (too large for git without LFS)
RUN python3 -c "\
import requests; \
r = requests.get('https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.83/lib/index.js', timeout=120); \
r.raise_for_status(); \
open('distro/pug/static/webllm.js', 'wb').write(r.content); \
print(f'WebLLM: {len(r.content)} bytes written')"

EXPOSE 7860

CMD ["gunicorn", "--bind", "0.0.0.0:7860", "--workers", "2", "--threads", "4", "--worker-class", "gthread", "--timeout", "120", "--access-logfile", "-", "app:create_app()"]
