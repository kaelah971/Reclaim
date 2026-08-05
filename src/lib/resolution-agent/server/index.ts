// ---------------------------------------------------------------------------
// Resolution Agent — server-only barrel export
// SERVER-ONLY — do NOT re-export from the public ../index.ts barrel
// ---------------------------------------------------------------------------

export {
  WALLET_ENCRYPTION_KEY_ENV,
  WALLET_ENCRYPTION_KEY_BYTES,
  parseWalletEncryptionKey,
} from "./config";

export {
  createAssociatedData,
  encryptCaseWalletPrivateKey,
  decryptCaseWalletPrivateKey,
  withDecryptedCaseWalletAccount,
} from "./encryption";

export {
  isValidEVMPrivateKey,
  generateEncryptedCaseWallet,
} from "./wallet";
