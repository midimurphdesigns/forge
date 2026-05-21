import { getCalibration } from "@/lib/calibration";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const stats = await getCalibration();
  return Response.json(stats);
}
