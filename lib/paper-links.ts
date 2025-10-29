function cleanInput(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDoi(value: string | null | undefined): string | null {
  const raw = cleanInput(value);
  if (!raw) {
    return null;
  }

  const withoutPrefix = raw
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim();

  if (!withoutPrefix) {
    return null;
  }

  return /^10\.\d{4,9}\/\S+/i.test(withoutPrefix) ? withoutPrefix : null;
}

function normalizeArxiv(value: string | null | undefined): string | null {
  const raw = cleanInput(value);
  if (!raw) {
    return null;
  }

  const prefixedMatch = raw.match(/^arx(?:iv)?[:\s]+(.+)$/i);
  const candidate = (prefixedMatch ? prefixedMatch[1] : raw).trim();
  if (!candidate) {
    return null;
  }

  return /^(?:\d{4}\.\d{4,5}(?:v\d+)?|[a-z\-]+\/\d{7}(?:v\d+)?)$/i.test(candidate) ? candidate : null;
}

function normalizeUrl(value: string | null | undefined): string | null {
  const raw = cleanInput(value);
  if (!raw) {
    return null;
  }

  if (/^(?:https?|ftp|blob):/i.test(raw)) {
    return raw;
  }

  if (/^www\./i.test(raw)) {
    return `https://${raw}`;
  }

  return null;
}

export function resolvePaperHref(input: {
  url?: string | null;
  doi?: string | null;
  identifier?: string | null;
}): string | null {
  const directUrl = normalizeUrl(input.url);
  if (directUrl) {
    return directUrl;
  }

  const doi = normalizeDoi(input.doi);
  if (doi) {
    return `https://doi.org/${doi}`;
  }

  const idUrl = normalizeUrl(input.identifier);
  if (idUrl) {
    return idUrl;
  }

  const identifierDoi = normalizeDoi(input.identifier);
  if (identifierDoi) {
    return `https://doi.org/${identifierDoi}`;
  }

  const arxivId = normalizeArxiv(input.identifier);
  if (arxivId) {
    return `https://arxiv.org/abs/${arxivId}`;
  }

  return null;
}

export function resolveDoiMetadata(value: string | null | undefined): { doi: string; href: string } | null {
  const doi = normalizeDoi(value);
  if (!doi) {
    return null;
  }
  return { doi, href: `https://doi.org/${doi}` };
}

function normalizePatentNumber(value: string | null | undefined): string | null {
  const raw = cleanInput(value);
  if (!raw) {
    return null;
  }
  return raw.replace(/\s+/g, "").toUpperCase();
}

export function resolvePatentHref(input: {
  url?: string | null;
  patentNumber?: string | null;
  identifier?: string | null;
}): string | null {
  const directUrl = normalizeUrl(input.url ?? input.identifier);
  if (directUrl) {
    return directUrl;
  }

  const normalizedNumber = normalizePatentNumber(input.patentNumber ?? input.identifier);
  if (!normalizedNumber) {
    return null;
  }

  // Default to Google Patents which supports most global identifiers (US, WO, EP, etc.).
  return `https://patents.google.com/patent/${encodeURIComponent(normalizedNumber)}`;
}
