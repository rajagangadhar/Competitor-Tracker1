import admin from "firebase-admin";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

let serviceAccount;

try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    // Decode Base64 environment variable
    const decoded = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, "base64").toString("utf-8");
    serviceAccount = JSON.parse(decoded);
  } else {
    // Fallback for local development
    serviceAccount = JSON.parse(fs.readFileSync("./config/serviceAccountKey.json", "utf8"));
  }
} catch (err) {
  console.error("Error loading Firebase service account:", err);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const adminAuth = admin.auth();

export { db, admin, FieldValue, adminAuth };
