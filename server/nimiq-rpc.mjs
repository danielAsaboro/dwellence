function decodeRecipientData(value) {
  if (typeof value !== "string") return "";
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    return /^[\x20-\x7e]*$/.test(decoded) ? decoded : value;
  } catch {
    return value;
  }
}

export async function lookupIncludedTransaction(
  rpcUrl,
  hash,
  fetchImpl = fetch,
  timeoutMs = 10_000,
) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  let response;
  try {
    response = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `purchase-${hash}`,
      method: "getTransactionByHash",
      params: [hash],
    }),
    });
  } catch (error) {
    if (timedOut) throw new Error("Nimiq RPC request timed out");
    throw error;
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok)
    throw new Error(`Nimiq RPC returned HTTP ${response.status}`);
  const body = await response.json();
  if (
    body.error &&
    /transaction not found/i.test(String(body.error.data ?? body.error.message))
  )
    return null;
  if (body.error)
    throw new Error(
      `Nimiq RPC error: ${body.error.message ?? body.error.code}`,
    );
  if (!body.result) return null;
  const transaction = body.result;
  return {
    recipient: transaction.recipient ?? transaction.to,
    valueLuna: Number(transaction.value),
    reference: decodeRecipientData(transaction.recipientData),
    blockNumber: Number.isInteger(transaction.blockNumber)
      ? transaction.blockNumber
      : null,
  };
}
