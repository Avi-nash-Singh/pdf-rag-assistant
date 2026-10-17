import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import * as lancedb from "@lancedb/lancedb";
import { getFileHash, sqlString, withRetry } from "./helpers.js";
import { fileURLToPath, pathToFileURL } from "node:url";

const DB_PATH = "./data/lancedb";
const TABLE_NAME = "documents_v2";
const UPLOADS_ROOT = path.resolve("./uploads");

import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

function chunkPage(text, pageNumber) {
  const chunkSize = 1000;
  const overlap = 150;
  const chunks = [];

  for (
    let start = 0;
    start < text.length;
    start += chunkSize - overlap
  ) {
    const part = text
      .slice(start, start + chunkSize)
      .trim();

    if (part) {
      chunks.push({ text: part, pageNumber });
    }

    if (start + chunkSize >= text.length) {
      break;
    }
  }

  return chunks;
}

async function extractPdfChunks(buffer) {
  const standardFontDataUrl = pathToFileURL(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "node_modules",
      "pdfjs-dist",
      "standard_fonts"
    ) + path.sep
  ).href;

  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    standardFontDataUrl,
  });

  const chunks = [];

  try {
    // Wait for PDF.js to load the document.
    const pdf = await loadingTask.promise;

    for (
      let pageNumber = 1;
      pageNumber <= pdf.numPages;
      pageNumber++
    ) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();

      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      chunks.push(...chunkPage(text, pageNumber));
    }

    return chunks;
  } finally {
    // Destroy the loading task, not the PDF document.
    await loadingTask.destroy().catch(() => {});
  }
}

async function createDocumentEmbedding(text) {
  const result = await withRetry(() =>
    ai.models.embedContent({
      model: "gemini-embedding-001",
      contents: text,
      config: {
        taskType: "RETRIEVAL_DOCUMENT",
        outputDimensionality: 768,
      },
    })
  );

  const vector = result.embeddings?.[0]?.values;

  if (!vector || vector.length !== 768) {
    throw new Error("Could not create a valid document embedding.");
  }

  return vector;
}

async function getTableIfExists(db) {
  const names = await db.tableNames();

  if (!names.includes(TABLE_NAME)) {
    return null;
  }

  return db.openTable(TABLE_NAME);
}

export async function ingestPdf({
  ownerId,
  originalName,
  buffer,
}) {
  const fileHash = getFileHash(buffer);
  const documentId = fileHash;

  const db = await lancedb.connect(DB_PATH);
  const existingTable = await getTableIfExists(db);

  // 1. Do not ingest the same file twice for this owner.
  if (existingTable) {
    const existing = await existingTable
      .query()
      .where(
        `ownerId = ${sqlString(ownerId)} AND fileHash = ${sqlString(fileHash)}`
      )
      .limit(1)
      .toArray();

    if (existing.length > 0) {
      return {
        duplicate: true,
        documentId,
        chunks: 0,
        message: "This document has already been uploaded.",
      };
    }
  }

  // 2. Extract text from the PDF.
  const chunks = await extractPdfChunks(buffer);

  if (chunks.length === 0) {
    throw new Error(
      "No readable text was found. This PDF may be scanned and require OCR."
    );
  }

  // 3. Create embeddings before writing any chunks.
  const safeFileName = path
    .basename(originalName)
    .replace(/[\r\n"]/g, "_");

  const records = [];

  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index];
    const vector = await createDocumentEmbedding(chunk.text);

    records.push({
      id: `${ownerId}-${fileHash}-${index}`,
      ownerId,
      documentId,
      fileHash,
      source: safeFileName,
      pageNumber: chunk.pageNumber,
      chunkIndex: index,
      text: chunk.text,
      vector,
      storagePath: "",
    });
  }

  // 4. Save the original PDF under a server-generated path.
  const ownerDirectory = path.join(
    UPLOADS_ROOT,
    ownerId
  );

  await fs.mkdir(ownerDirectory, { recursive: true });

  const storagePath = path.join(
    ownerDirectory,
    `${fileHash}.pdf`
  );

  await fs.writeFile(storagePath, buffer);

  // Store the path with each chunk so we can delete the PDF later.
  for (const record of records) {
    record.storagePath = storagePath;
  }

  // 5. Create the table for the first document, or append rows.
  try {
    const table = await getTableIfExists(db);

    if (table) {
      await table.add(records);
    } else {
      await db.createTable(TABLE_NAME, records);
    }
  } catch (error) {
    await fs.unlink(storagePath).catch(() => {});
    throw error;
  }

  return {
    duplicate: false,
    documentId,
    chunks: records.length,
    message: "Document ingested successfully.",
  };
}