/**
 * Hand-maintained declaration for `qrcode` (no `@types/qrcode` in the
 * dependency tree). Only the surface this codebase uses is declared: SVG string
 * rendering and the raw module matrix the branded-QR renderer walks.
 */
declare module "qrcode" {
  export type QRCodeErrorCorrectionLevel =
    "L" | "M" | "Q" | "H" | "low" | "medium" | "quartile" | "high";

  export interface QRCodeRenderersOptions {
    type?: "svg" | "utf8" | "terminal";
    errorCorrectionLevel?: QRCodeErrorCorrectionLevel;
    version?: number;
    margin?: number;
    scale?: number;
    width?: number;
    color?: { dark?: string; light?: string };
  }

  export interface QRCodeCreateOptions {
    errorCorrectionLevel?: QRCodeErrorCorrectionLevel;
    version?: number;
  }

  /** Module matrix of an encoded symbol (`size` modules per side). */
  export interface BitMatrix {
    size: number;
    data: Uint8Array;
    get(row: number, column: number): number;
  }

  export interface QRCode {
    modules: BitMatrix;
    version: number;
    errorCorrectionLevel: { bit: number };
    maskPattern: number;
    segments: unknown[];
  }

  export function create(text: string, options?: QRCodeCreateOptions): QRCode;
  export function toString(text: string, options?: QRCodeRenderersOptions): Promise<string>;

  const qrcode: {
    create: typeof create;
    toString: typeof toString;
  };
  export default qrcode;
}
