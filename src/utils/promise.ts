export const isPromise = (v: any): boolean | any =>
    v !== null && typeof v === "object" && typeof (v as any).then === "function";

export const isResponse = (v: any): v is Response =>
    v !== null &&
    typeof v === "object" &&
    typeof (v as any).status === "number" &&
    typeof (v as any).headers === "object";