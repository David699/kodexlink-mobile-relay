import { generatePairingQrPngBase64WithNode } from "./qr-image-node.js";

export async function generatePairingQrPngBase64(payload: string): Promise<string> {
  return generatePairingQrPngBase64WithNode(payload);
}
