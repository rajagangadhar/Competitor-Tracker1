import { adminAuth } from "../config/firebaseAdmin.js"; // Ensure you export adminAuth in firebaseAdmin.js
import { db } from "../config/firebaseAdmin.js";

export async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    console.warn("[Auth] No Bearer token in header.");
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = authHeader.split("Bearer ")[1];
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    console.log("[Auth] Token verified for UID:", decoded.uid);
    req.user = decoded; // Attach UID for later
    next();
  } catch (error) {
    console.error("[Auth] Token verification failed:", error.code, error.message);
    return res.status(401).json({ error: "Invalid token" });
  }
}
