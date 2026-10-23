import openapiTS, { astToString } from "openapi-typescript";
import { openApiDocument } from "./document";

const HEADER = "// Generated from openapi.json by `npm run gen` — do not edit.\n\n";

/** The committed generated files: the OpenAPI document and the client's types made from it. */
export async function generatedFiles(): Promise<{ openapi: string; types: string }> {
  const doc = openApiDocument();
  const openapi = JSON.stringify(doc, null, 2) + "\n";
  const types = HEADER + astToString(await openapiTS(openapi));
  return { openapi, types };
}
