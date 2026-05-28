import dotenv from "dotenv";
dotenv.config();

const PORT = process.env.PORT || 3000;

console.log("Environment variables loaded.");
console.log("PORT:", PORT);
