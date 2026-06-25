export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startNightlyArchivePurgeScheduler } = await import("./lib/nightly-cleanup-scheduler")
    startNightlyArchivePurgeScheduler()
  }
}
