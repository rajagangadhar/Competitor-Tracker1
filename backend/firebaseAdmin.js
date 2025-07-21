import admin from "firebase-admin";
import { readFileSync } from "fs";
import serviceAccount from "./config/serviceAccountKey.json" assert { type: "json" };

const serviceAccount = JSON.parse(readFileSync("./serviceAccountKey.json", "utf-8"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://hackathon-bb760.firebaseio.com",
});

export const adminAuth = admin.auth();
export const db = admin.firestore();
