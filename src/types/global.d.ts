/// <reference path="./express.d.ts" />

declare class BarcodeDetector {
  constructor(options?: { formats?: string[] });
  static getSupportedFormats?(): Promise<string[]>;
  detect(source: ImageBitmapSource): Promise<Array<{ rawValue?: string }>>;
}
