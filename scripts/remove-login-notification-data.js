import mongoose from "mongoose";

const apply = process.argv.includes("--apply");
const collectionNames = ["loginevents", "securitynotifications", "notificationpreferences", "webpushsubscriptions"];

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required.");
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(({ name }) => name));

  console.log(apply
    ? "APPLY MODE: removing only login activity and login notification data."
    : "DRY RUN: no database changes will be made. Re-run with --apply to execute.");

  for (const name of collectionNames) {
    const count = existing.has(name) ? await db.collection(name).countDocuments() : 0;
    console.log(`- ${name}: ${count} document(s) ${apply ? "to remove" : "would be removed"}`);
  }

  if (existing.has("sessions")) {
    const sessions = db.collection("sessions");
    const count = await sessions.countDocuments({ alertSuppressionKey: { $exists: true } });
    console.log(`- sessions.alertSuppressionKey: ${count} field(s) ${apply ? "to unset" : "would be unset"}`);
    if (apply) {
      for (const index of await sessions.listIndexes().toArray()) {
        if (index.key?.alertSuppressionKey === 1) {
          await sessions.dropIndex(index.name);
          console.log(`  dropped index ${index.name}`);
        }
      }
      if (count) await sessions.updateMany(
        { alertSuppressionKey: { $exists: true } },
        { $unset: { alertSuppressionKey: "" } },
      );
    }
  }

  if (apply) {
    for (const name of collectionNames) {
      if (existing.has(name)) {
        await db.dropCollection(name);
        console.log(`  dropped collection ${name}`);
      }
    }
  } else {
    console.log("No changes made. Back up MongoDB, review counts, then run with --apply when ready.");
  }
};

try {
  await run();
} catch (error) {
  console.error("Login notification data cleanup failed:", error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}
