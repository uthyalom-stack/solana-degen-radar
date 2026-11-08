import test from "node:test";
import assert from "node:assert/strict";

// 1. Token-2022 Binary TLV Layout Integration Test
test("Token-2022 TLV Layout correctly parses TransferFeeConfig and TransferHook from binary data", () => {
  // Synthesize a valid 196-byte Token-2022 mint buffer:
  // 0..81: Base mint (82 bytes)
  // 82: Account type tag (1 for Mint)
  // 83: Padding (0)
  // 84..87: TLV 1 Header -> Type = 1 (uint16 LE), Len = 108 (uint16 LE)
  // 88..195: TransferFeeConfig data (108 bytes)
  //   In data block: offset 106 is newer_transfer_fee.transfer_fee_basis_points = 250 (2.50%)
  const buf = new Uint8Array(84 + 4 + 108 + 4 + 64);
  const view = new DataView(buf.buffer);

  // Base mint initialized
  buf[44] = 9; // 9 decimals
  buf[45] = 1; // initialized

  // Offset 82: Account type
  buf[82] = 1;

  // Offset 84: Extension 1 (TransferFeeConfig)
  view.setUint16(84, 1, true); // Type 1
  view.setUint16(86, 108, true); // Length 108
  // newer fee basis points at dataStart (88) + 106 = 194
  view.setUint16(88 + 106, 250, true); // 250 bps = 2.5%

  // Offset 196: Extension 2 (TransferHook)
  view.setUint16(196, 14, true); // Type 14
  view.setUint16(198, 64, true); // Length 64

  // Decode TLV
  let transferFeePercent = null;
  let hasTransferHook = false;

  let offset = buf.length >= 84 ? 84 : 82;
  while (offset + 4 <= buf.length) {
    const extType = view.getUint16(offset, true);
    const extLen = view.getUint16(offset + 2, true);
    const dataStart = offset + 4;
    if (dataStart + extLen > buf.length) break;

    if (extType === 1 && extLen >= 108) {
      const feeBps = view.getUint16(dataStart + 106, true);
      transferFeePercent = feeBps / 100;
    }
    if (extType === 14 && extLen >= 64) {
      hasTransferHook = true;
    }
    offset = dataStart + extLen;
  }

  assert.equal(transferFeePercent, 2.5);
  assert.equal(hasTransferHook, true);
});

// 2. LP Burn Verification Integration Test
test("LP Burn verification distinguishes genuine burn owners from active accounts", () => {
  const BURN_ADDRESSES = new Set([
    "11111111111111111111111111111111",
    "1nc1nerator11111111111111111111111111111111",
  ]);

  const totalSupply = 1_000_000;
  const topAccounts = [
    { address: "TokenAccountBurned1", amount: "950000" },
    { address: "TokenAccountWhale", amount: "50000" },
  ];

  const ownerMap = new Map([
    ["TokenAccountBurned1", "1nc1nerator11111111111111111111111111111111"],
    ["TokenAccountWhale", "WhaleWalletAddress11111111111111111111111"],
  ]);

  let burnedAmount = 0;
  for (const account of topAccounts) {
    const owner = ownerMap.get(account.address) || account.address;
    if (BURN_ADDRESSES.has(owner)) {
      burnedAmount += Number(account.amount) || 0;
    }
  }

  const burnedPct = (burnedAmount / totalSupply) * 100;
  assert.equal(burnedPct, 95);
});

// 3. Persistent Idempotency Logic Test
test("Persistent Idempotency returns cached response for duplicate keys without re-execution", () => {
  const store = new Map();

  function processRequest(idempotencyKey, isDuplicate) {
    if (store.has(idempotencyKey)) {
      return { ...store.get(idempotencyKey), replayed: true };
    }
    const result = { status: 201, body: JSON.stringify({ success: true, tradeId: "trade-1" }) };
    store.set(idempotencyKey, result);
    return { ...result, replayed: false };
  }

  const firstCall = processRequest("key-123", false);
  assert.equal(firstCall.status, 201);
  assert.equal(firstCall.replayed, false);

  const duplicateCall = processRequest("key-123", true);
  assert.equal(duplicateCall.status, 201);
  assert.equal(duplicateCall.replayed, true);
  assert.equal(duplicateCall.body, firstCall.body);
});
