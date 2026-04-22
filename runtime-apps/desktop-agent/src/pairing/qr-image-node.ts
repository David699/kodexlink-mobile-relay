import QRCode from "qrcode";

export async function generatePairingQrPngBase64WithNode(payload: string): Promise<string> {
  const dataUrl = await QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 420,
    type: "image/png"
  });

  const matched = dataUrl.match(/^data:image\/png;base64,(.+)$/);
  if (!matched || !matched[1]) {
    throw new Error("failed to generate QR image payload");
  }

  return matched[1];
}
