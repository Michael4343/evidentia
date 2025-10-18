export interface UploadError {
  message: string;
  isRetryable: boolean;
}

const MAX_FILE_SIZE_MB = 50;
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

export function parseUploadError(error: unknown): UploadError {
  if (!error) {
    return {
      message: "An unknown error occurred. Please try again.",
      isRetryable: true
    };
  }

  const errorObj = error as any;
  const message = errorObj?.message || String(error);
  const statusCode = errorObj?.statusCode || errorObj?.status;

  // Storage quota errors
  if (message.includes("quota") || message.includes("storage limit") || statusCode === 413) {
    return {
      message: "Storage limit reached. Please contact support to increase your quota.",
      isRetryable: false
    };
  }

  // Network/connection errors
  if (
    message.includes("fetch") ||
    message.includes("network") ||
    message.includes("NetworkError") ||
    message.includes("Failed to fetch")
  ) {
    return {
      message: "Connection lost. Check your internet and try again.",
      isRetryable: true
    };
  }

  // Authentication errors
  if (
    message.includes("auth") ||
    message.includes("session") ||
    message.includes("JWT") ||
    statusCode === 401 ||
    statusCode === 403
  ) {
    return {
      message: "Session expired. Please sign in again.",
      isRetryable: false
    };
  }

  // Storage bucket errors
  if (
    message.includes("bucket") ||
    message.includes("storage") ||
    message.includes("upload failed")
  ) {
    return {
      message: "File upload failed. Check your connection and try again.",
      isRetryable: true
    };
  }

  // Database errors
  if (message.includes("database") || message.includes("insert") || message.includes("unique")) {
    return {
      message: "Failed to save paper metadata. Please try again or contact support.",
      isRetryable: true
    };
  }

  // Generic fallback
  return {
    message: "Could not save your paper. Please try again.",
    isRetryable: true
  };
}

export function validateFileSize(file: File): { valid: true } | { valid: false; error: UploadError } {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: {
        message: `File is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum size is ${MAX_FILE_SIZE_MB}MB.`,
        isRetryable: false
      }
    };
  }
  return { valid: true };
}
