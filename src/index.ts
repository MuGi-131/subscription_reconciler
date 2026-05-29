import dotenv from "dotenv";
import app from "./app";
dotenv.config();

const PORT = process.env.PORT || 3000;

async function main() {
  // TODO: db, worker, app load
  app.listen(PORT, () => {
    console.log(`Reconciler service running on port ${PORT}`);
  });
}

main().catch((err) => {
  console.log("Failed to start: ", err);
  process.exit(1);
});
