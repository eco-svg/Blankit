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

EXPOSE 7860

CMD ["gunicorn", "--bind", "0.0.0.0:7860", "--workers", "2", "--timeout", "120", "--access-logfile", "-", "app:create_app()"]
