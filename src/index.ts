import dotenv from "dotenv";
dotenv.config();

import app from "./app";
import { runMigrations } from "./db/migrate";

const PORT = process.env.PORT || 3000;

async function main() {
  // TODO: worker
  await runMigrations();

  app.listen(PORT, () => {
    console.log(`Reconciler service running on port ${PORT}`);
  });
}

main().catch((err) => {
  console.log("Failed to start: ", err);
  process.exit(1);
});
