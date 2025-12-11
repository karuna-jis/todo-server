// Test Firebase Admin SDK Connection
// Run: node test-firebase-connection.js

require("dotenv").config();
const admin = require("firebase-admin");

console.log("🔍 Testing Firebase Admin SDK Connection...\n");

// Try to load service account
let serviceAccount = null;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    console.log("✅ Loaded service account from FIREBASE_SERVICE_ACCOUNT env variable");
  } catch (error) {
    console.error("❌ Failed to parse FIREBASE_SERVICE_ACCOUNT:", error.message);
  }
} else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
  try {
    serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
    console.log("✅ Loaded service account from file:", process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
  } catch (error) {
    console.error("❌ Failed to load service account from file:", error.message);
  }
} else {
  try {
    serviceAccount = require("./serviceAccountKey.json");
    console.log("✅ Loaded service account from serviceAccountKey.json");
  } catch (error) {
    console.error("❌ Failed to load serviceAccountKey.json:", error.message);
  }
}

if (!serviceAccount) {
  console.error("\n❌ ERROR: No service account found!");
  console.error("   Please provide service account key in one of these ways:");
  console.error("   1. Set FIREBASE_SERVICE_ACCOUNT environment variable");
  console.error("   2. Set FIREBASE_SERVICE_ACCOUNT_PATH environment variable");
  console.error("   3. Place serviceAccountKey.json in notification-server folder");
  process.exit(1);
}

// Validate service account structure
console.log("\n📋 Service Account Details:");
console.log("   Project ID:", serviceAccount.project_id);
console.log("   Client Email:", serviceAccount.client_email);
console.log("   Type:", serviceAccount.type);

if (!serviceAccount.project_id) {
  console.error("\n❌ ERROR: Service account missing project_id!");
  process.exit(1);
}

if (!serviceAccount.client_email) {
  console.error("\n❌ ERROR: Service account missing client_email!");
  process.exit(1);
}

if (!serviceAccount.private_key) {
  console.error("\n❌ ERROR: Service account missing private_key!");
  process.exit(1);
}

// Initialize Firebase Admin SDK
try {
  if (admin.apps.length > 0) {
    admin.app().delete();
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id,
  });

  console.log("\n✅ Firebase Admin SDK initialized successfully");
  console.log("   Project ID:", admin.app().options.projectId);

  // Test messaging
  const messaging = admin.messaging();
  console.log("\n✅ Messaging service initialized");

  // Test with a dummy token (this will fail but shows if API is accessible)
  console.log("\n🧪 Testing FCM API connection...");
  console.log("   (This will fail with invalid token, but confirms API is accessible)");

  const testMessage = {
    token: "test-token-invalid",
    notification: {
      title: "Test",
      body: "Test",
    },
  };

  messaging.send(testMessage)
    .then(() => {
      console.log("✅ FCM API is accessible (unexpected success)");
    })
    .catch((error) => {
      if (error.code === "messaging/invalid-registration-token" || 
          error.code === "messaging/registration-token-not-registered") {
        console.log("✅ FCM API is accessible (expected error for invalid token)");
        console.log("   Error code:", error.code);
      } else if (error.message.includes("404") || error.message.includes("Not Found")) {
        console.error("\n❌ ERROR: FCM API endpoint not found (404)");
        console.error("   This usually means:");
        console.error("   1. Service account doesn't have FCM permissions");
        console.error("   2. Firebase project doesn't have FCM enabled");
        console.error("   3. Service account is for wrong project");
        console.error("\n   Solution:");
        console.error("   1. Go to Firebase Console → Project Settings → Service Accounts");
        console.error("   2. Generate a NEW service account key");
        console.error("   3. Make sure it has 'Firebase Cloud Messaging Admin' role");
        console.error("   4. Replace your serviceAccountKey.json with the new one");
      } else {
        console.error("\n❌ ERROR:", error.message);
        console.error("   Error code:", error.code);
      }
    });

} catch (error) {
  console.error("\n❌ ERROR initializing Firebase Admin SDK:", error.message);
  console.error("   Stack:", error.stack);
  process.exit(1);
}

