export function getTutorialEmbedUrl(rawUrl: string | undefined | null): string | null {
  if (!rawUrl) {
    return null;
  }
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (error) {
    console.warn("Invalid tutorial URL", error);
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  let videoId = "";

  const extractIdFromPath = (path: string) => {
    const segments = path.split("/").filter(Boolean);
    return segments[segments.length - 1] ?? "";
  };

  if (host.includes("youtube.com")) {
    if (parsed.pathname === "/watch") {
      videoId = parsed.searchParams.get("v") ?? "";
    } else if (parsed.pathname.startsWith("/embed/")) {
      videoId = extractIdFromPath(parsed.pathname);
    } else if (parsed.pathname.startsWith("/shorts/")) {
      videoId = extractIdFromPath(parsed.pathname);
    }
  } else if (host === "youtu.be") {
    videoId = extractIdFromPath(parsed.pathname);
  } else if (host === "youtube-nocookie.com" || host.endsWith("youtube-nocookie.com")) {
    videoId = extractIdFromPath(parsed.pathname);
  }

  const normalized = videoId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!normalized) {
    return null;
  }

  return `https://www.youtube.com/embed/${normalized}?rel=0&modestbranding=1`;
}
