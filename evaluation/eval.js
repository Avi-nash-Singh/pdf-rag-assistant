
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { evalDataset } from "./eval-dataset.js";
import {
  retrieveChunks,
  generateGroundedAnswer,
} from "../rag.js";

// Use the same owner ID you used when uploading the PDF.
const OWNER_ID = "binnu";
const TOP_K = 3;

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const model =
  process.env.GEMINI_GENERATION_MODEL || "gemini-3.1-flash-lite";

function getChunkText(chunk) {
  return String(
    chunk.text ?? chunk.content ?? chunk.chunkText ?? ""
  );
}

function getAnswerText(result) {
  if (typeof result === "string") return result;

  return String(
    result?.answer ?? result?.text ?? result?.response ?? ""
  );
}

function calculateRetrievalMetrics(chunks, expectedKeywords) {
  const texts = chunks.map(getChunkText);

  const relevantChunks = texts.filter((text) =>
    expectedKeywords.some((keyword) =>
      text.toLowerCase().includes(keyword.toLowerCase())
    )
  );

  return {
    hit: relevantChunks.length > 0 ? 1 : 0,
    precision: texts.length
      ? relevantChunks.length / texts.length
      : 0,
    relevantChunks,
    texts,
  };
}

async function evaluateFaithfulness(question, answer, contexts) {
  if (!answer || contexts.length === 0) {
    return {
      score: 0,
      explanation: "No answer or no retrieved context.",
    };
  }

  const prompt = `
You are evaluating a RAG application's answer.

Question:
${question}

Retrieved source text:
${contexts.join("\n\n--- SOURCE SEPARATOR ---\n\n")}

Generated answer:
${answer}

Judge only whether the generated answer is supported by the
retrieved source text. Do not reward outside knowledge.

Return ONLY valid JSON in this format:
{
  "score": 0,
  "explanation": "Short explanation"
}

Score rules:
1 = Every factual claim is supported by the source text.
0.5 = Some claims are supported, but others are unsupported
      or the source is insufficient to verify them.
0 = The answer contradicts the source or is mostly unsupported.

If the answer says the information is unavailable and the
source does not contain the answer, score it 1.
`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
  });

  const raw = response.text ?? "";
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    const judgment = JSON.parse(cleaned);

    return {
      score: Math.max(
        0,
        Math.min(1, Number(judgment.score) || 0)
      ),
      explanation: judgment.explanation ?? "",
    };
  } catch {
    return {
      score: 0,
      explanation: `Could not parse judge response: ${raw}`,
    };
  }
}

async function main() {
  const results = [];

  for (const test of evalDataset) {
    console.log(`\nTesting: ${test.question}`);

    try {
      // Step 1: Retrieve source chunks.
      const chunks = await retrieveChunks(
        test.question,
        OWNER_ID,
        TOP_K
      );

      // Step 2: Measure retrieval.
      const retrieval = calculateRetrievalMetrics(
        chunks,
        test.expectedKeywords
      );

      // Step 3: Generate an answer using your existing RAG.
      const generated = await generateGroundedAnswer(
        test.question,
        chunks
      );

      const answer = getAnswerText(generated);

      // Step 4: Ask Gemini to judge the answer against sources.
      const faithfulness = await evaluateFaithfulness(
        test.question,
        answer,
        retrieval.texts
      );

      const result = {
        question: test.question,
        expectedAnswer: test.expectedAnswer,
        retrievedChunks: chunks.length,
        retrievalHit: retrieval.hit,
        contextPrecision: retrieval.precision,
        answer,
        faithfulness: faithfulness.score,
        explanation: faithfulness.explanation,
      };

      results.push(result);

      console.log("Retrieved chunks:", result.retrievedChunks);
      console.log("Retrieval hit:", result.retrievalHit);
      console.log(
        "Keyword-based context precision:",
        `${(result.contextPrecision * 100).toFixed(1)}%`
      );
      console.log("Generated answer:", result.answer);
      console.log(
        "Faithfulness:",
        `${(result.faithfulness * 100).toFixed(1)}%`
      );
      console.log("Judge explanation:", result.explanation);
    } catch (error) {
      console.error("Evaluation failed:", error.message);
    }
  }

  if (results.length === 0) {
    console.log("No test cases completed.");
    return;
  }

  const average = (key) =>
    results.reduce((sum, item) => sum + item[key], 0) /
    results.length;

  console.log("\n========== FINAL EVALUATION ==========");
  console.log("Completed tests:", results.length);
  console.log(
    "Retrieval hit rate:",
    `${(average("retrievalHit") * 100).toFixed(1)}%`
  );
  console.log(
    "Average keyword-based context precision:",
    `${(average("contextPrecision") * 100).toFixed(1)}%`
  );
  console.log(
    "Average faithfulness:",
    `${(average("faithfulness") * 100).toFixed(1)}%`
  );
}

main();
