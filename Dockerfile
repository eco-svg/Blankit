FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    gcc g++ cmake git \
    libopenblas-dev \
    libpq-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# Install everything except llama-cpp-python first
RUN grep -v "llama-cpp-python" requirements.txt > /tmp/req_no_llama.txt && \
    pip install --no-cache-dir -r /tmp/req_no_llama.txt

# Install llama-cpp-python with OpenBLAS for CPU performance
RUN CMAKE_ARGS="-DGGML_BLAS=ON -DGGML_BLAS_VENDOR=OpenBLAS" \
    pip install --no-cache-dir "llama-cpp-python>=0.3.0"

COPY . .

EXPOSE 7860

CMD ["python", "app.py"]
