/**
 * Clean malformed URLs and emails from LLM-generated markdown
 *
 * This module provides utilities to extract clean URLs and emails from
 * markdown-formatted strings that may contain malformed patterns.
 */

/**
 * Extract a clean URL from a potentially malformed string
 *
 * Handles three patterns:
 * 1. Malformed markdown: "url](url" or "url](url)" → extract first URL before "]"
 * 2. Proper markdown: "[text](url)" → extract URL from parentheses
 * 3. Plain URL: "url" → return as-is
 *
 * @param {string} input - The input string that may contain a malformed URL
 * @returns {string} The cleaned URL, or empty string if input is invalid
 *
 * @example
 * cleanUrlStrict("https://sae.ethz.ch/](https://sae.ethz.ch/")
 * // Returns: "https://sae.ethz.ch/"
 *
 * @example
 * cleanUrlStrict("https://www.canr.msu.edu/kravchenkolab/](https://www.canr.msu.edu/kravchenkolab/")
 * // Returns: "https://www.canr.msu.edu/kravchenkolab/"
 *
 * @example
 * cleanUrlStrict("[https://example.com](https://example.com)")
 * // Returns: "https://example.com"
 *
 * @example
 * cleanUrlStrict("https://example.com")
 * // Returns: "https://example.com"
 */
function cleanUrlStrict(input) {
  if (!input || typeof input !== 'string') {
    return input;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return '';
  }

  // Pattern 1: Malformed markdown "url](url" or "url](url)"
  // Extract everything from http(s):// up to (but not including) the first "]"
  const malformedMatch = trimmed.match(/^(https?:\/\/[^\]]+)\]/);
  if (malformedMatch) {
    return malformedMatch[1];
  }

  // Pattern 2: Proper markdown "[text](url)" or "[url](url)"
  // Extract URL from parentheses
  const markdownMatch = trimmed.match(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/);
  if (markdownMatch) {
    return markdownMatch[2];
  }

  // Pattern 3: Plain URL - return as-is
  return trimmed;
}

/**
 * Extract a clean email address from a potentially malformed string
 *
 * Handles these patterns:
 * 1. Mailto markdown: "[email](mailto:email)" → extract email
 * 2. Plain mailto: "mailto:email" → extract email
 * 3. Markdown without mailto: "[email](email)" → extract from brackets if contains @
 * 4. Plain email: "email" → return as-is
 *
 * @param {string} input - The input string that may contain a malformed email
 * @returns {string} The cleaned email address (lowercase), or empty string if input is invalid
 *
 * @example
 * cleanEmailStrict("[jsix@ethz.ch](mailto:jsix@ethz.ch)")
 * // Returns: "jsix@ethz.ch"
 *
 * @example
 * cleanEmailStrict("mailto:user@example.com")
 * // Returns: "user@example.com"
 *
 * @example
 * cleanEmailStrict("user@example.com")
 * // Returns: "user@example.com"
 */
function cleanEmailStrict(input) {
  if (!input || typeof input !== 'string') {
    return input;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return '';
  }

  // Pattern 1: Markdown mailto link "[email](mailto:email)"
  const mailtoMarkdownMatch = trimmed.match(/\[([^\]]+)\]\(mailto:([^)]+)\)/);
  if (mailtoMarkdownMatch) {
    return mailtoMarkdownMatch[1].trim().toLowerCase();
  }

  // Pattern 2: Plain mailto "mailto:email"
  const plainMailtoMatch = trimmed.match(/mailto:([^\s)]+)/);
  if (plainMailtoMatch) {
    return plainMailtoMatch[1].trim().toLowerCase();
  }

  // Pattern 3: Markdown link without mailto "[email](email)" or "[email](url)"
  const markdownMatch = trimmed.match(/\[([^\]]+)\]\([^)]+\)/);
  if (markdownMatch) {
    const extracted = markdownMatch[1].trim();
    if (extracted.includes('@')) {
      return extracted.toLowerCase();
    }
  }

  // Pattern 4: Plain email - return as-is (lowercase)
  if (trimmed.includes('@')) {
    return trimmed.toLowerCase();
  }

  return trimmed;
}

module.exports = {
  cleanUrlStrict,
  cleanEmailStrict
};
