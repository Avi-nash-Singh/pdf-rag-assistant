import { createHash } from "node:crypto";

export function getFileHash(buffer) {
  return createHash("sha256")
    .update(buffer)
    .digest("hex");
}

export function sqlString(value) {
  return "'" + String(value).replaceAll("'", "''") + "'";
}

function isRetryable(error) {
  const status = error?.status ?? error?.statusCode;

  return (
    status === 429 ||
    [500, 502, 503, 504].includes(status) ||
    ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"].includes(
      error?.code
    )
  );
}

export async function withRetry(
  operation,
  maxAttempts = 3
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (
        attempt === maxAttempts ||
        !isRetryable(error)
      ) {
        throw error;
      }

      const delay = 1000 * 2 ** (attempt - 1);

      console.log(
        `Temporary failure. Attempt ${attempt + 1}/${maxAttempts} in ${delay}ms`
      );

      await new Promise((resolve) =>
        setTimeout(resolve, delay)
      );
    }
  }
}