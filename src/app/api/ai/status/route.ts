import { llmInfo } from "@/server/llm";

export async function GET() {
  return Response.json(llmInfo());
}
