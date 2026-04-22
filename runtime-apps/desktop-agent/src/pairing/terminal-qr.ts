import QRCode from "qrcode";

const TERMINAL_QR_MARGIN = 1;

export function canRenderTerminalQr(): boolean {
  return process.stdout.isTTY === true;
}

export async function renderTerminalQr(payload: string): Promise<string> {
  return QRCode.toString(payload, {
    type: "terminal",
    small: true,
    margin: TERMINAL_QR_MARGIN
  });
}
