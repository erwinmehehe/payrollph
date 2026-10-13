export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertProductionPiiKey } = await import("./lib/pii-key-policy");
    assertProductionPiiKey();
  }
}
