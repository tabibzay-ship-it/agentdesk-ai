import "server-only";

export type ParsedOrigin = {
  origin: string;
  hostname: string;
};

function normalizeHostname(hostname: string) {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/\.+$/, "");
}

export function parseRequestOrigin(
  originHeader: string | null
): ParsedOrigin | null {
  if (!originHeader) {
    return null;
  }

  const value = originHeader.trim();

  if (
    !value ||
    value === "null" ||
    !/^https?:\/\/[^\s/?#\\]+$/i.test(value)
  ) {
    return null;
  }

  try {
    const url = new URL(value);

    if (
      (url.protocol !== "http:" &&
        url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }

    const hostname = normalizeHostname(url.hostname);

    if (!hostname || hostname.includes("*")) {
      return null;
    }

    return {
      origin: url.origin,
      hostname,
    };
  } catch {
    return null;
  }
}

function normalizeAllowedDomain(
  entry: string
): string | null {
  const value = entry.trim();

  if (!value) {
    return null;
  }

  try {
    const hasProtocol =
      /^[a-z][a-z\d+.-]*:\/\//i.test(value);
    const url = new URL(
      hasProtocol ? value : `https://${value}`
    );

    if (
      (url.protocol !== "http:" &&
        url.protocol !== "https:") ||
      url.username ||
      url.password
    ) {
      return null;
    }

    const hostname = normalizeHostname(url.hostname);

    if (!hostname || hostname.includes("*")) {
      return null;
    }

    return hostname;
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname: string) {
  const value = normalizeHostname(hostname);

  return (
    value === "localhost" ||
    value === "127.0.0.1" ||
    value === "::1" ||
    value === "[::1]"
  );
}

export function isRequestOriginAllowed(
  request: Request,
  requestOrigin: ParsedOrigin | null,
  allowedDomains: unknown
) {
  const configuredEntries = Array.isArray(allowedDomains)
    ? allowedDomains.filter(
        (entry): entry is string =>
          typeof entry === "string" &&
          entry.trim().length > 0
      )
    : [];

  if (configuredEntries.length === 0) {
    return true;
  }

  if (!requestOrigin) {
    return false;
  }

  let requestUrl: URL;

  try {
    requestUrl = new URL(request.url);
  } catch {
    return false;
  }

  if (requestOrigin.origin === requestUrl.origin) {
    return true;
  }

  if (
    process.env.NODE_ENV !== "production" &&
    isLoopbackHostname(requestOrigin.hostname) &&
    isLoopbackHostname(requestUrl.hostname)
  ) {
    return true;
  }

  const allowedHostnames = new Set(
    configuredEntries
      .map(normalizeAllowedDomain)
      .filter(
        (hostname): hostname is string =>
          hostname !== null
      )
  );

  return allowedHostnames.has(requestOrigin.hostname);
}

export function isOpaqueOrigin(originHeader: string | null) {
  return originHeader?.trim() === "null";
}

export function getCorsOrigin(
  originHeader: string | null,
  requestOrigin: ParsedOrigin | null
) {
  return (
    requestOrigin?.origin ??
    (isOpaqueOrigin(originHeader) ? "null" : null)
  );
}

export function buildCorsHeaders(
  allowedOrigin: string | null,
  allowedMethods: string
) {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": allowedMethods,
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };

  if (allowedOrigin) {
    headers["Access-Control-Allow-Origin"] =
      allowedOrigin;
  }

  return headers;
}
