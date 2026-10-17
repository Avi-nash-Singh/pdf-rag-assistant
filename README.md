# PDF RAG Assistant

A Retrieval-Augmented Generation (RAG) application that lets users upload PDF documents and ask questions about their contents. It retrieves relevant text chunks using vector similarity search and uses Google Gemini to generate answers grounded in the retrieved context.

## Features

- **PDF ingestion:** Extracts text from uploaded PDF documents.
- **Text chunking:** Splits extracted text into smaller chunks for retrieval.
- **Embeddings:** Generates document and query embeddings using Google's `gemini-embedding-001` model.
- **Vector search:** Stores and retrieves document chunks using LanceDB.
- **Grounded answers:** Uses Google Gemini to answer questions based on retrieved source text.
- **Source-aware prompting:** Instructs the model to cite retrieved sources and acknowledge missing information.
- **Document management:** Supports document upload and deletion through API endpoints.
- **RAG evaluation:** Evaluates retrieval hit rate, keyword-based context precision, and answer faithfulness.
- **Retry handling:** Retries selected temporary failures using a reusable helper.

## Tech Stack

- **Runtime:** Node.js
- **Backend:** Express.js
- **AI model integration:** Google GenAI SDK
- **Embedding model:** `gemini-embedding-001`
- **Generation model:** Configurable through environment variables
- **Vector database:** LanceDB
- **PDF processing:** `pdfjs-dist`
- **File uploads:** Multer
- **Configuration:** dotenv

## How RAG Works

1. Upload a PDF through the API.
2. Extract text from the PDF.
3. Divide the text into smaller chunks.
4. Generate an embedding for each chunk.
5. Store the chunks, metadata, and vectors in LanceDB.
6. Convert a user's question into a query embedding.
7. Retrieve the most relevant chunks using vector similarity search.
8. Pass the retrieved context and question to Gemini.
9. Generate an answer grounded in the available document context.
10. Evaluate retrieval quality and answer faithfulness using a test dataset.

## Project Structure

```text
pdf-rag-assistant/
├── evaluation/
│   ├── eval-dataset.js
│   └── eval.js
├── server.js
├── ingest.js
├── rag.js
├── helpers.js
├── package.json
├── package-lock.json
├── .env.example
├── .gitignore
└── README.md
```

The local `uploads/` has to be created for docs upload and `data/` for the lancedb.

## Prerequisites

- Node.js installed
- npm installed
- A Google Gemini API key
- Git installed
- A GitHub account

## Installation

Clone the repository:

```bash
git clone https://github.com/YOUR_USERNAME/pdf-rag-assistant.git
cd pdf-rag-assistant
```

Install dependencies:

```bash
npm install
```

Create a `.env` file in the project root:

```env
GEMINI_API_KEY=your_gemini_api_key
GEMINI_GENERATION_MODEL=gemini-3.1-flash-lite
PORT=3000
```

Replace `your_gemini_api_key` with your own API key. Never commit the `.env` file.

The generation model can be changed to another model available to your account.

## Running the Application

Start the API server:

```bash
node server.js
```

If your `package.json` defines a start script, you can use:

```bash
npm start
```

The API uses the configured port, which defaults to `3000`.

## API Endpoints

The application currently provides these endpoints:

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/documents` | Upload and ingest a PDF |
| `POST` | `/ask` | Ask a question about ingested documents |
| `DELETE` | `/documents/:documentId` | Delete an ingested document |

The application uses an `x-demo-user` header to scope document access in the current demo implementation.

For exact request body fields and upload requirements, refer to `server.js` and test the endpoints using Postman.

## RAG Evaluation

Run the evaluation script:

```bash
node eval.js
```

The evaluation uses test cases defined in `eval-dataset.js`.

### Metrics

**1. Retrieval hit rate**

Measures how often retrieval returns at least one chunk matching the expected keywords.

**2. Keyword-based context precision**

Measures the proportion of retrieved chunks that match the configured expected keywords. This is a simple proxy, not a full semantic relevance metric.

**3. Faithfulness**

Uses Gemini as an automated judge to estimate whether generated answers are supported by the retrieved context.

### Improving Evaluation Quality

- Use questions and reference answers verified against the source PDFs.
- Test questions with direct answers, multi-chunk answers, and answers absent from the documents.
- Manually inspect retrieved chunks.
- Evaluate answer correctness separately from faithfulness.
- Test on a larger dataset before drawing conclusions about system quality.

Evaluation results depend on the test dataset and should not be interpreted as a guarantee of production accuracy.

## Security Considerations

This project is intended as a learning and demonstration project.

- Never commit API keys or other secrets.
- Do not upload private documents to a public repository.
- The `x-demo-user` header is not real authentication. A client can choose another header value.
- Before public deployment, implement proper authentication and authorization.
- Validate uploads, enforce file-size limits, and apply appropriate rate limits.
- Protect stored documents and vectors from unauthorized access.
- Handle sensitive information in logs and error responses carefully.

## Future Improvements

- Implement production-grade authentication and authorization.
- Add document-level access controls.
- Improve chunking and retrieval strategies.
- Add semantic relevance and answer-correctness evaluation.
- Add OCR support for scanned PDFs.
- Support additional document formats.
- Add automated tests and CI workflows.
- Add observability for retrieval quality, latency, and model usage.

## Learning Objectives

This project demonstrates practical experience with:

- Node.js and Express APIs
- PDF text extraction and processing
- Embeddings and vector databases
- Semantic similarity search
- Retrieval-Augmented Generation
- Grounded LLM responses
- Basic RAG evaluation
- Environment configuration and API security fundamentals

