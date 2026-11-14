use crate::install_signature::{VerifyError, verify_reader};
use std::io::{self, Cursor, Read};

// Public test vectors from tauri-plugin-updater 2.14.0 and minisign-verify 0.3.0.
// The Tauri vector signs the four bytes `test`. No signing key is included.
const KEY: &str = include_str!("../tests/fixtures/tauri-test.pub");
const SIGNATURE: &str = include_str!("../tests/fixtures/tauri-test.sig.txt");
const OTHER_KEY: &str = include_str!("../tests/fixtures/minisign-test.pub");
const LEGACY: &str = include_str!("../tests/fixtures/minisign-legacy.sig.txt");

// Encode fixture text in the same outer base64 format used by the updater.
fn encode(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut encoded = String::new();
    for chunk in bytes.chunks(3) {
        let a = chunk[0];
        let b = *chunk.get(1).unwrap_or(&0);
        let c = *chunk.get(2).unwrap_or(&0);
        encoded.push(ALPHABET[(a >> 2) as usize] as char);
        encoded.push(ALPHABET[(((a & 3) << 4) | (b >> 4)) as usize] as char);
        encoded.push(if chunk.len() > 1 {
            ALPHABET[(((b & 15) << 2) | (c >> 6)) as usize] as char
        } else {
            '='
        });
        encoded.push(if chunk.len() > 2 {
            ALPHABET[(c & 63) as usize] as char
        } else {
            '='
        });
    }
    encoded
}

fn check(key: Option<&str>, signature: &str, installer: &[u8]) -> Result<(), VerifyError> {
    let key = key.map(|text| encode(text.as_bytes()));
    let signature = encode(signature.as_bytes());
    verify_reader(
        key.as_deref(),
        signature.as_bytes(),
        &mut Cursor::new(installer),
    )
}

#[test]
fn valid_tauri_signature_verifies_the_installer_bytes() {
    assert_eq!(check(Some(KEY), SIGNATURE, b"test"), Ok(()));
}

#[test]
fn rejects_tampering_and_a_different_valid_key() {
    assert_eq!(
        check(Some(KEY), SIGNATURE, b"Test"),
        Err(VerifyError::VerificationFailed)
    );
    assert_eq!(
        check(Some(OTHER_KEY), SIGNATURE, b"test"),
        Err(VerifyError::VerificationFailed)
    );
}

#[test]
fn rejects_absent_and_malformed_key_without_accepting_installer() {
    assert_eq!(
        check(None, SIGNATURE, b"test"),
        Err(VerifyError::MissingKey)
    );
    assert_eq!(
        check(Some("not a minisign key"), SIGNATURE, b"test"),
        Err(VerifyError::MalformedKey)
    );
    assert_eq!(
        verify_reader(
            Some("!!!"),
            encode(SIGNATURE.as_bytes()).as_bytes(),
            &mut Cursor::new(b"test")
        ),
        Err(VerifyError::MalformedKey)
    );
}

#[test]
fn rejects_missing_and_malformed_signature() {
    let key = encode(KEY.as_bytes());
    for bad in [&b""[..], &b"!!!"[..], &b"bm90IGEgc2lnbmF0dXJl"[..]] {
        assert_eq!(
            verify_reader(Some(&key), bad, &mut Cursor::new(b"test")),
            Err(VerifyError::MalformedSignature)
        );
    }
}

#[test]
fn rejects_tampered_trusted_comment() {
    let changed = SIGNATURE.replace("file:payload", "file:other");
    assert_eq!(
        check(Some(KEY), &changed, b"test"),
        Err(VerifyError::VerificationFailed)
    );
}

#[test]
fn legacy_signatures_are_rejected_distinctly() {
    assert_eq!(
        check(Some(OTHER_KEY), LEGACY, b"test"),
        Err(VerifyError::LegacySignature)
    );
}

struct BrokenReader;
impl Read for BrokenReader {
    fn read(&mut self, _buf: &mut [u8]) -> io::Result<usize> {
        Err(io::Error::other("fixture read failure"))
    }
}
#[test]
fn fails_closed_on_installer_read_error() {
    let key = encode(KEY.as_bytes());
    let signature = encode(SIGNATURE.as_bytes());
    assert_eq!(
        verify_reader(Some(&key), signature.as_bytes(), &mut BrokenReader),
        Err(VerifyError::ReadFailed)
    );
}
