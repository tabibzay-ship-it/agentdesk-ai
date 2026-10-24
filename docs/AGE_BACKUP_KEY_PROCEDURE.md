# AgentDesk production backup key procedure

This procedure prepares recipient-based `age` encryption without authorizing a production backup or real key generation. The D: and F: volumes are fully decrypted, so every production dump artifact must remain encrypted by `age` at all times. Neither volume may contain a private identity or its passphrase.

## Required key separation

Create two distinct native age identities only after explicit owner approval:

1. An operator identity on an access-controlled encrypted device used for scheduled verification.
2. An offline recovery identity on a separate encrypted removable device held by a different custodian or stored in a different secured location.

Derive and record only the public `age1...` recipients in the operating record. Encrypt every artifact to both recipients. The backup script rejects duplicate recipients.

## Passphrases and escrow

- Protect each identity with a different randomly generated passphrase of at least eight Diceware-style words, or with an encrypted device protected by an equivalently strong recovery secret.
- Never reuse a Windows, Supabase, email, password-manager, or application password.
- Record each passphrase offline, separately from its identity device and separately from the backup media.
- Do not place passphrases in environment variables, command history, chat, the repository, D:, F:, metadata, or checksum files.
- Document the custodian, sealed-copy location, creation date, and last recovery test without recording the secret itself.

## Pre-production verification

Before a production backup, encrypt synthetic content to both recipients. Test each identity independently, confirm the plaintext SHA-256 hash, then disconnect the identity device. A backup is not recoverable until both independent tests pass.

## Backup handling

- A valid v2 set contains the six required encrypted database artifacts, encrypted Storage objects, `manifest.json`, `SHA256SUMS.txt`, and `BACKUP_COMPLETE`.
- The database artifacts are roles, application schema, application data, migration-history schema/data, and reviewed managed `auth`/`storage` customizations.
- Any set containing `BACKUP_INCOMPLETE`, lacking `BACKUP_COMPLETE`, or failing strict manifest, artifact, Storage inventory, size, or hash validation is quarantined and must not be copied or restored.
- Partial encrypted files remain sensitive. Retain them only for diagnosis until separately approved cleanup; never attempt to repair them into a valid set.
- Verify the primary set before copying it to a separately approved, healthy physical/off-site destination, and verify the independent copy again. Drive letters do not prove physical independence. Never use damaged or unreliable media.

## Recovery exercise

Recovery uses one identity at a time. Never connect both identity devices simultaneously. Stream decryption directly into a network-isolated recovery database and never create plaintext SQL files. Record the verification date and result, then disconnect and secure the identity device.
