# RAG.AI - Multi-Document RAG System with Citations

An entirely local, AI-powered system designed for reliable, source-verified question answering across multiple documents. Built to address the hallucination problem in Large Language Models by anchoring every response to explicit, verifiable document citations.

## 🚀 Key Features

*   **Multi-Document Intelligence:** Query across several uploaded PDFs, DOCX files, and text documents simultaneously.
*   **Verifiable Source Citations:** Every generated sentence is backed by a specific document and page number. Click citations to view the exact text chunk the AI referenced.
*   **100% Local & Private:** Runs entirely on your machine. No API keys, no cloud data sharing, and completely offline using Ollama.
*   **Global Chat History:** Chat history is persisted on the backend server, allowing you to access synced conversations across any device on your local network.
*   **Auralis/Quiet Luxury UI:** A premium, dark-mode focused, highly responsive interface.

---

## 🛠️ Technology Stack

### Backend (Python 3.13 / FastAPI)
*   **Framework:** FastAPI for high-performance, asynchronous REST APIs.
*   **Document Processing:** `pdfplumber` and `pypdf` for robust PDF text extraction; `python-docx` for Word documents.
*   **Chunking Strategy:** Page-aware, sentence-boundary segmentation to ensure context isn't lost mid-sentence.
*   **Embeddings:** `nomic-embed-text` (running locally via Ollama) to convert text chunks into high-dimensional vectors (768 dimensions).
*   **Vector Database:** Custom **Local In-Memory Vector Store** using NumPy for fast Cosine Similarity semantic search.
*   **Generation (LLM):** `qwen2.5:7b` (running locally via Ollama), instructed specifically to answer *only* using provided context.

### Frontend (React / TypeScript)
*   **Framework:** React 18 with Vite for lightning-fast HMR and building.
*   **Styling:** Tailwind CSS + Vanilla CSS (`index.css` for custom markdown styling).
*   **Network Exposure:** Configured to bind to `0.0.0.0`, proxying API requests so the app can be accessed flawlessly from smartphones and other laptops on the local university network.

---

## 🧠 System Architecture & Flow (For Viva/Presentation)

The application functions in two distinct pipelines:

### 1. Document Processing Pipeline (Indexing)
When a user uploads a document:
1.  **Extraction:** The file is routed based on extension (`.pdf`, `.docx`, etc.). `pdfplumber` extracts text page-by-page.
2.  **Chunking:** The text is split into smaller, manageable passages (chunks). Each chunk retains its metadata (Document Name, Page Number).
3.  **Embedding:** The chunk text is sent to the `nomic-embed-text` model, which returns a mathematical vector representing the semantic meaning of the text.
4.  **Storage:** The vector and metadata are stored in the Local In-Memory Vector Database.

### 2. Question Answering Pipeline (Retrieval & Generation)
When a user asks a question:
1.  **Query Embedding:** The user's question is converted into a vector using the exact same embedding model (`nomic-embed-text`).
2.  **Semantic Search:** The system performs a Cosine Similarity calculation between the question vector and all stored document vectors. It retrieves the top `K` (usually 4) most relevant chunks.
3.  **Prompt Synthesis:** The retrieved chunks are injected into a strict system prompt instructing `qwen2.5:7b` to answer the user's question *using only the provided context*.
4.  **Generation & Citation:** The LLM generates the answer. Because the context chunks carried page metadata, the backend maps the LLM's references back to the original documents, returning a grounded answer with clickable UI citations.
5.  **History Persistence:** The Q&A pair is saved to `chat_history.json` on the backend, ensuring state is maintained for any device connecting to the server's IP.

---

## ⚙️ How to Run

### Prerequisites
1.  **Node.js & npm** (For frontend)
2.  **Python 3.13** (For backend)
3.  **Ollama** installed with the following models downloaded:
    *   `ollama run qwen2.5:7b`
    *   `ollama pull nomic-embed-text`

### 1. Start Ollama
Ensure the Ollama daemon is running and accessible:
```bash
# PowerShell
$env:OLLAMA_HOST="127.0.0.1:11434"
ollama serve
```

### 2. Start the Backend
```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python run.py
```
*The backend will run on `http://0.0.0.0:8000`*

### 3. Start the Frontend
```bash
cd frontend
npm install
npm run dev
```
*The frontend will run on `http://localhost:5173` and broadcast to your local network IPs.*

---

## 💡 Potential Viva Questions & Answers

**Q: Why didn't you use a persistent database like ChromaDB or Pinecone?**
**A:** We opted for a lightweight, Local In-Memory vector store using NumPy. This guarantees zero external network calls, absolute data privacy, and a much simpler deployment footprint for local hardware, while still achieving rapid cosine similarity lookups.

**Q: How do you prevent the LLM from hallucinating?**
**A:** Through prompt engineering. The LLM (`qwen2.5:7b`) is wrapped in a strict system prompt that forces it to output "I don't know" if the answer is not found in the retrieved context. It is fundamentally restricted from answering from its pre-trained memory.

**Q: Why `qwen2.5:7b` instead of a 14B or 70B model?**
**A:** Speed and hardware constraints. During testing, larger models (like DeepSeek 14B) caused significant latency (35+ seconds). Switching to Qwen 2.5 7B reduced generation time to ~8 seconds while maintaining high reasoning capabilities, making the application actually usable in real-time.
