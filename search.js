import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import * as lancedb from "@lancedb/lancedb";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

async function createQueryEmbedding(question) {
  const result = await ai.models.embedContent({
    model: "gemini-embedding-001",
    contents: question,
    config: {
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: 768,
    },
  });

  return result.embeddings[0].values;
}
async function similaritySearch(question, topK = 3) {
  // 1. Convert the question into a vector
  const queryVector = await createQueryEmbedding(question);

  // 2. Connect to your existing local database
  const db = await lancedb.connect("./data/lancedb");

  // 3. Open the table created by ingest.js
  const table = await db.openTable("pdf_chunks");

  // 4. Find the closest matching chunks
  const results = await table
    .vectorSearch(queryVector)
    .limit(topK)
    .toArray();

  return results;
}

function formatResults(results) {
  return results.map((chunk, index) => ({
    rank: index + 1,

    text: chunk.text,

    citation: {
      source: chunk.source,
      page: chunk.pageNumber,
      chunkIndex: chunk.chunkIndex,
    },

    distance: chunk._distance,
  }));
}

async function main() {
  const question =
    "Platform with real-time transaction";

  const results = await similaritySearch(question, 3);

  const formattedResults = formatResults(results);

  console.log(JSON.stringify(formattedResults, null, 2));
}

main().catch(console.error);