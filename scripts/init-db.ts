import { initializeDatabase } from "@/lib/db";

initializeDatabase()
  .then(() => {
    console.log("Database initialized.");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
