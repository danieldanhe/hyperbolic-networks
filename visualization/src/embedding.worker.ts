import { embedNetwork } from "./embedding";

const ctx: Worker = self as any;

ctx.onmessage = async (e: MessageEvent<{ csvContent: string }>) => {
  try {
    const { csvContent } = e.data;

    if (!csvContent) {
      ctx.postMessage({
        type: "ERROR",
        message: "No CSV content provided to worker.",
      });
      return;
    }

    const result = await embedNetwork(csvContent);

    ctx.postMessage({ type: "SUCCESS", result });
  } catch (error) {
    console.error("Embedding worker error:", error);
    ctx.postMessage({
      type: "ERROR",
      message: (error as Error).message || "Unknown error in embedding worker",
    });
  }
};

export default {} as typeof Worker & (new () => Worker);
