//! Tauri-updater-compatible installer signature verification.
//!
//! Keys and signatures are standard-base64 encoded minisign text files, as used by Tauri.
//! Only the current prehashed signature format is accepted: legacy signatures fail with a
//! distinct error. Verification is streamed, so a large installer is never buffered in memory.
//! A successful cryptographic check alone does not authorize execution; the caller must also
//! protect the verified file and its path through process creation.
use std::io::Read;

use base64::{Engine, engine::general_purpose::STANDARD};
use minisign_verify::{Error as MinisignError, PublicKey, Signature};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VerifyError {
    MissingKey,
    MalformedKey,
    MalformedSignature,
    LegacySignature,
    VerificationFailed,
    ReadFailed,
}

/// Verify a readable installer from its current position. The caller must supply the exact open
/// file that will remain protected through execution, and must position it at the beginning.
pub fn verify_reader(
    key: Option<&str>,
    signature: &[u8],
    installer: &mut impl Read,
) -> Result<(), VerifyError> {
    let key = key.ok_or(VerifyError::MissingKey)?;
    if key.len() > crate::install_download::SIGNATURE_LIMIT as usize {
        return Err(VerifyError::MalformedKey);
    }
    let key_bytes = STANDARD
        .decode(key)
        .map_err(|_| VerifyError::MalformedKey)?;
    let key_text = std::str::from_utf8(&key_bytes).map_err(|_| VerifyError::MalformedKey)?;
    let mut key_lines = key_text.lines();
    if !key_lines
        .next()
        .is_some_and(|line| line.starts_with("untrusted comment: "))
        || key_lines.next().is_none()
        || key_lines.next().is_some()
    {
        return Err(VerifyError::MalformedKey);
    }
    let key = PublicKey::decode(key_text).map_err(|_| VerifyError::MalformedKey)?;
    if signature.len() > crate::install_download::SIGNATURE_LIMIT as usize {
        return Err(VerifyError::MalformedSignature);
    }
    let signature_bytes = STANDARD
        .decode(signature)
        .map_err(|_| VerifyError::MalformedSignature)?;
    let signature_text =
        std::str::from_utf8(&signature_bytes).map_err(|_| VerifyError::MalformedSignature)?;
    let signature =
        Signature::decode(signature_text).map_err(|_| VerifyError::MalformedSignature)?;
    let mut verifier = key.verify_stream(&signature).map_err(|error| match error {
        MinisignError::UnsupportedLegacyMode => VerifyError::LegacySignature,
        _ => VerifyError::VerificationFailed,
    })?;
    let mut buffer = [0; 64 * 1024];
    loop {
        match installer.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => verifier.update(&buffer[..count]),
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return Err(VerifyError::ReadFailed),
        }
    }
    verifier
        .finalize()
        .map_err(|_| VerifyError::VerificationFailed)
}
