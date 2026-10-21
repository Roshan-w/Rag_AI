FROM python:3.11-slim

# Tesseract OCR with English, Hindi and Marathi language packs
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng tesseract-ocr-hin tesseract-ocr-mar \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Source is bind-mounted at /app at runtime so code updates don't need a rebuild
CMD ["python", "run.py"]
