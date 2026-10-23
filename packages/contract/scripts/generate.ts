import { writeFile } from "node:fs/promises";
import { generatedFiles } from "../src/generate";

const files = await generatedFiles();
await writeFile(new URL("../openapi.json", import.meta.url), files.openapi);
await writeFile(new URL("../src/generated/api.ts", import.meta.url), files.types);
console.log("openapi.json and src/generated/api.ts written");
