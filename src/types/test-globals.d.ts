declare function describe(name: string, fn: () => any): void;
declare function it(name: string, fn: () => any): void;
declare function test(name: string, fn: () => any): void;

declare module "node-mocks-http" {
  export function createRequest(opts?: any): any;
  export function createResponse(opts?: any): any;
}
