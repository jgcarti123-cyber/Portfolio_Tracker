import { mood } from "@/server/providers";
import { bad } from "@/server/validate";

/** Market mood readings (crypto, India, US). No user data is sent or needed. */
export async function GET() {
  try {
    return Response.json(await mood());
  } catch (err) {
    return bad(err instanceof Error ? err.message : "Market mood unavailable", 502);
  }
}
