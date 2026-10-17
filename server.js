import "dotenv/config";
import express from "express";
import multer from "multer";
import fs from "node:fs/promises";
import path from "node:path";
import * as lancedb from "@lancedb/lancedb";

import { ingestPdf } from "./ingest.js";
import { sqlString } from "./helpers.js";
import { retrieveChunks, generateGroundedAnswer } from "./rag.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = "./data/lancedb";
const TABLE_NAME = "documents_v2";
const UPLOADS_ROOT = path.resolve("./uploads");

// Demo only: replace this with real authentication before deployment.
function demoAuth(req, res, next) {
  const userId = req.header("x-demo-user");

  if (!userId || !/^[a-zA-Z0-9_-]{1,64}$/.test(userId)) {
    return res.status(401).json({
      error: "Provide a valid demo user in the x-demo-user header.",
    });
  }

  req.user = { id: userId };
  next();
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
    files: 1,
  },
  fileFilter(req, file, callback) {
    if (file.mimetype !== "application/pdf") {
      return callback(new Error("Only PDF files are allowed."));
    }

    callback(null, true);
  },
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// 1. Upload a PDF and ingest its chunks.
app.post("/documents", demoAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'Attach a PDF using the form field named "file".',
      });
    }

    // MIME type can be faked, so also check the PDF signature.
    if (req.file.buffer.subarray(0, 5).toString() !== "%PDF-") {
      return res.status(400).json({
        error: "The uploaded file is not a valid PDF.",
      });
    }

    const result = await ingestPdf({
      ownerId: req.user.id,
      originalName: req.file.originalname,
      buffer: req.file.buffer,
    });

    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    console.error("Upload failed:", error);

    return res.status(500).json({
      error: error.message || "Could not process the PDF.",
    });
  }
});

// 2. Ask a question about the authenticated user's documents.
app.post("/ask", demoAuth, async (req, res) => {
  try {
    const { question } = req.body ?? {};

    if (
      typeof question !== "string" ||
      !question.trim() ||
      question.length > 2000
    ) {
      return res.status(400).json({
        error: "Question must be between 1 and 2000 characters.",
      });
    }

    const cleanQuestion = question.trim();

    const chunks = await retrieveChunks(cleanQuestion, req.user.id, 3);

    if (chunks.length === 0) {
      return res.json({
        question: cleanQuestion,
        answer: "I could not find relevant information in your documents.",
        citations: [],
      });
    }

    const answer = await generateGroundedAnswer(cleanQuestion, chunks);

    const citations = chunks.map((chunk, index) => ({
      sourceId: index + 1,
      document: chunk.source,
      page: chunk.pageNumber,
      text: chunk.text,
    }));

    return res.json({
      question: cleanQuestion,
      answer,
      citations,
    });
  } catch (error) {
    console.error("Question failed:", error);

    return res.status(500).json({
      error: "Could not answer the question.",
    });
  }
});

// 3. Delete all chunks for a document and its stored PDF.
app.delete("/documents/:documentId", demoAuth, async (req, res) => {
  try {
    const { documentId } = req.params;

    // Our document IDs are SHA-256 hashes.
    if (!/^[a-f0-9]{64}$/.test(documentId)) {
      return res.status(400).json({
        error: "Invalid document ID.",
      });
    }

    const db = await lancedb.connect(DB_PATH);
    const tableNames = await db.tableNames();

    if (!tableNames.includes(TABLE_NAME)) {
      return res.status(404).json({
        error: "Document not found.",
      });
    }

    const table = await db.openTable(TABLE_NAME);

    const predicate =
      `ownerId = ${sqlString(req.user.id)} AND ` +
      `documentId = ${sqlString(documentId)}`;

    const rows = await table.query().where(predicate).limit(1).toArray();

    if (rows.length === 0) {
      return res.status(404).json({
        error: "Document not found.",
      });
    }

    const storagePath = rows[0].storagePath;
    const resolvedPath = path.resolve(storagePath);

    // Only delete files located inside our uploads folder.
    if (!resolvedPath.startsWith(UPLOADS_ROOT + path.sep)) {
      throw new Error("Unsafe document storage path.");
    }

    const deletedChunks = await table.countRows(predicate);

    await table.delete(predicate);

    // Remove the PDF only after its database rows are deleted.
    await fs.unlink(resolvedPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });

    return res.json({
      message: "Document deleted successfully.",
      documentId,
      deletedChunks,
    });
  } catch (error) {
    console.error("Deletion failed:", error);

    return res.status(500).json({
      error: "Could not delete the document.",
    });
  }
});

// Handle errors from Multer, including upload-size errors.
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      error: error.message,
    });
  }

  if (error.message === "Only PDF files are allowed.") {
    return res.status(400).json({
      error: error.message,
    });
  }

  console.error("Unhandled server error:", error);

  return res.status(500).json({
    error: "Internal server error.",
  });
});

app.listen(PORT, () => {
  console.log(`RAG server running at http://localhost:${PORT}`);
});
