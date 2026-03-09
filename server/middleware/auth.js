import jwt from "jsonwebtoken";

/** Parse a single named cookie from the raw Cookie header (no dep needed). */
function getCookie(req, name) {
  const header = req.headers.cookie || "";
  const entry = header
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(name + "="));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null;
}

export function requireAuth(req, res, next) {
  const token = getCookie(req, "portfolio_token");
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.sub; // integer user id
    next();
  } catch {
    // Clear the stale / tampered cookie
    res.clearCookie("portfolio_token", { path: "/" });
    return res.status(401).json({ error: "Session expired — please log in again" });
  }
}
