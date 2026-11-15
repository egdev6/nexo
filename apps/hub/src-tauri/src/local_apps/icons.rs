//! Icons are selected locally and copied into an owned directory. No path from
//! the webview is accepted, and only generated basenames can be cleaned up.
use super::{ExecutableFs, FileKind, FsError, Selection, entry_index, selection};
use crate::config::Store;
use serde_json::json;

pub(super) const MAX_ICON_BYTES: usize = 512 * 1024;

pub(super) trait IconPicker {
    fn pick_icon(&self) -> Result<Option<String>, String>;
}

pub(super) trait IconFs: ExecutableFs {
    /// Implementations must limit reads to MAX_ICON_BYTES + 1 bytes.
    fn read_icon(&self, path: &str) -> Result<Vec<u8>, String>;
    /// Read only a managed basename in the owned directory, bounded as above.
    fn read_owned_icon(&self, name: &str) -> Result<Vec<u8>, String>;
    /// Create a new owned file, never overwriting an existing file.
    fn save_icon(&self, bytes: &[u8], extension: &str) -> Result<String, String>;
    fn delete_icon(&self, name: &str) -> Result<(), String>;
}

// Only fixed-disk, absolute paths without reparse points are read. As with
// executable selection, do not canonicalize through links or access a UNC path.
pub(super) fn selected_file(
    fs: &impl ExecutableFs,
    path: &str,
) -> Result<(String, &'static str), String> {
    let path = path.replace('/', "\\");
    let bytes = path.as_bytes();
    if bytes.len() < 4 || !bytes[0].is_ascii_alphabetic() || bytes[1] != b':' || bytes[2] != b'\\' {
        return Err("nexo.local.refused".into());
    }
    let parts: Vec<&str> = path[3..].split('\\').collect();
    if parts.iter().any(|part| {
        part.is_empty()
            || *part == "."
            || *part == ".."
            || part.ends_with([' ', '.'])
            || part
                .chars()
                .any(|c| c.is_control() || "<>:\"|?*".contains(c))
    }) {
        return Err("nexo.local.refused".into());
    }
    let file = parts.last().expect("split has a component");
    let extension = match file.rsplit_once('.') {
        Some((stem, ext)) if !stem.trim().is_empty() && ext.eq_ignore_ascii_case("png") => "png",
        Some((stem, ext)) if !stem.trim().is_empty() && ext.eq_ignore_ascii_case("ico") => "ico",
        _ => return Err("nexo.local.invalidIcon".into()),
    };
    let mut current = path[..3].to_owned();
    if !fs.fixed_disk(&current) {
        return Err("nexo.local.refused".into());
    }
    match fs.inspect(&current) {
        Ok(FileKind::Directory) => {}
        Err(FsError::Missing) => return Err("nexo.local.missing".into()),
        _ => return Err("nexo.local.refused".into()),
    }
    for (index, part) in parts.iter().enumerate() {
        if index != 0 {
            current.push('\\');
        }
        current.push_str(part);
        match fs.inspect(&current) {
            Err(FsError::Missing) => return Err("nexo.local.missing".into()),
            Err(FsError::Refused) | Ok(FileKind::Reparse) => {
                return Err("nexo.local.refused".into());
            }
            Ok(FileKind::Directory) if index + 1 == parts.len() => {
                return Err("nexo.local.invalidIcon".into());
            }
            Ok(FileKind::File) if index + 1 != parts.len() => {
                return Err("nexo.local.refused".into());
            }
            Ok(FileKind::Directory | FileKind::File) => {}
        }
    }
    Ok((path, extension))
}

pub(super) fn managed_name(name: &str) -> bool {
    let Some((stem, extension)) = name.rsplit_once('.') else {
        return false;
    };
    let Some(id) = stem.strip_prefix("icon-") else {
        return false;
    };
    !id.is_empty()
        && id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
        && matches!(extension, "png" | "ico")
}

// This checks PNG structure and CRCs, not the compressed pixel stream. The
// decoder remains outside this boundary; no untrusted data is decompressed here.
fn valid_png(bytes: &[u8]) -> Option<()> {
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return None;
    }
    let mut offset = 8_usize;
    let mut header = false;
    let mut palette = false;
    let mut image_data = false;
    let mut data_ended = false;
    let mut data_len = 0_usize;
    let mut color = 0_u8;
    loop {
        let len = u32::from_be_bytes(bytes.get(offset..offset.checked_add(4)?)?.try_into().ok()?)
            as usize;
        let kind_start = offset.checked_add(4)?;
        let data_start = kind_start.checked_add(4)?;
        let data_end = data_start.checked_add(len)?;
        let end = data_end.checked_add(4)?;
        let kind = bytes.get(kind_start..data_start)?;
        let data = bytes.get(data_start..data_end)?;
        let checksum = u32::from_be_bytes(bytes.get(data_end..end)?.try_into().ok()?);
        if !kind.iter().all(u8::is_ascii_alphabetic) || !kind[2].is_ascii_uppercase() {
            return None;
        }
        let mut crc = !0_u32;
        for byte in kind.iter().chain(data) {
            crc ^= u32::from(*byte);
            for _ in 0..8 {
                crc = (crc >> 1) ^ (0xedb8_8320 & 0_u32.wrapping_sub(crc & 1));
            }
        }
        if !crc != checksum || (!header && kind != b"IHDR") {
            return None;
        }
        if image_data && kind != b"IDAT" {
            data_ended = true;
        }
        match kind {
            b"IHDR" if !header && len == 13 => {
                let width = u32::from_be_bytes(data[0..4].try_into().ok()?);
                let height = u32::from_be_bytes(data[4..8].try_into().ok()?);
                color = data[9];
                let valid_depth = match color {
                    0 => matches!(data[8], 1 | 2 | 4 | 8 | 16),
                    2 | 4 | 6 => matches!(data[8], 8 | 16),
                    3 => matches!(data[8], 1 | 2 | 4 | 8),
                    _ => false,
                };
                if !(1..=512).contains(&width)
                    || !(1..=512).contains(&height)
                    || !valid_depth
                    || data[10] != 0
                    || data[11] != 0
                    || data[12] > 1
                {
                    return None;
                }
                header = true;
            }
            b"PLTE" if !palette && !image_data && !matches!(color, 0 | 4) => {
                if len == 0 || len > 768 || !len.is_multiple_of(3) {
                    return None;
                }
                palette = true;
            }
            b"IDAT" if !data_ended && (color != 3 || palette) => {
                image_data = true;
                data_len = data_len.checked_add(len)?;
            }
            b"IEND" if len == 0 && image_data && data_len > 0 && end == bytes.len() => {
                return Some(());
            }
            b"IHDR" | b"PLTE" | b"IDAT" | b"IEND" => return None,
            _ if kind[0].is_ascii_uppercase() => return None,
            _ => {}
        }
        offset = end;
    }
}

// ICO directory dimensions are bytes (zero means 256). Bound both the number
// of entries and each referenced range; the embedded image is not decoded.
fn valid_ico(bytes: &[u8]) -> Option<()> {
    if bytes.get(..4)? != b"\0\0\x01\0" {
        return None;
    }
    let count = usize::from(u16::from_le_bytes(bytes.get(4..6)?.try_into().ok()?));
    if !(1..=64).contains(&count) {
        return None;
    }
    let directory_end = 6_usize.checked_add(count.checked_mul(16)?)?;
    let directory = bytes.get(6..directory_end)?;
    for entry in directory.as_chunks::<16>().0 {
        let size = u32::from_le_bytes(entry[8..12].try_into().ok()?) as usize;
        let start = u32::from_le_bytes(entry[12..16].try_into().ok()?) as usize;
        if entry[3] != 0
            || size == 0
            || size > MAX_ICON_BYTES
            || start < directory_end
            || start.checked_add(size)? > bytes.len()
        {
            return None;
        }
    }
    Some(())
}

pub(super) fn valid_icon(bytes: &[u8], extension: &str) -> bool {
    bytes.len() <= MAX_ICON_BYTES
        && match extension {
            "png" => valid_png(bytes).is_some(),
            "ico" => valid_ico(bytes).is_some(),
            _ => false,
        }
}

pub(super) fn delete_owned(fs: &impl IconFs, name: Option<&str>) -> Result<(), String> {
    if let Some(name) = name.filter(|name| managed_name(name)) {
        fs.delete_icon(name)?;
    }
    Ok(())
}

pub(super) fn pick_icon(
    store: &Store,
    fs: &impl IconFs,
    picker: &impl IconPicker,
    id: &str,
) -> Result<Option<Selection>, String> {
    let Some(path) = picker.pick_icon()? else {
        return Ok(None);
    };
    let (path, extension) = selected_file(fs, &path)?;
    let bytes = fs.read_icon(&path)?;
    if !valid_icon(&bytes, extension) {
        return Err("nexo.local.invalidIcon".into());
    }
    let name = save_valid_icon(fs, &bytes, extension)?;
    let saved = store.mutate_local_apps(|entries, settings| {
        let index = entry_index(entries, settings, id)?;
        let mut app = settings
            .local_apps
            .iter()
            .find(|app| app.id == id)
            .expect("entry checked")
            .clone();
        let old = app.icon.replace(name.clone());
        let unshared = old.filter(|old| {
            !settings
                .local_apps
                .iter()
                .any(|other| other.id != id && other.icon.as_ref() == Some(old))
        });
        entries[index]
            .as_object_mut()
            .ok_or("nexo.local.refused")?
            .insert("icon".into(), json!(name));
        Ok((selection(app, settings), unshared))
    });
    match saved {
        Ok((selected, old)) => {
            if let Err(error) = delete_owned(fs, old.as_deref()) {
                eprintln!("could not clean up replaced local icon: {error}");
            }
            Ok(Some(selected))
        }
        Err(error) => {
            delete_owned(fs, Some(&name)).map_err(|cleanup| format!("{error}; {cleanup}"))?;
            Err(error)
        }
    }
}

// Shared by existing icon replacement and creation, preserving managed-name checks.
pub(super) fn save_valid_icon(
    fs: &impl IconFs,
    bytes: &[u8],
    extension: &str,
) -> Result<String, String> {
    if !valid_icon(bytes, extension) {
        return Err("nexo.local.invalidIcon".into());
    }
    let name = fs.save_icon(bytes, extension)?;
    if !managed_name(&name) {
        return Err("nexo.local.iconWriteFailed".into());
    }
    Ok(name)
}

pub(super) fn icon_data(store: &Store, fs: &impl IconFs, id: &str) -> Option<String> {
    let settings = store.local_settings().ok()?;
    let name = settings
        .local_apps
        .iter()
        .find(|app| app.id == id)?
        .icon
        .as_deref()?;
    if !managed_name(name) {
        return None;
    }
    let extension = name.rsplit_once('.')?.1;
    let bytes = fs.read_owned_icon(name).ok()?;
    if !valid_icon(&bytes, extension) {
        return None;
    }
    icon_data_url(&bytes, extension)
}

pub(super) fn icon_data_url(bytes: &[u8], extension: &str) -> Option<String> {
    let mime = match extension {
        "png" => "image/png",
        "ico" => "image/x-icon",
        _ => return None,
    };
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = format!("data:{mime};base64,");
    for group in bytes.chunks(3) {
        let a = group[0];
        let b = group.get(1).copied().unwrap_or(0);
        let c = group.get(2).copied().unwrap_or(0);
        output.push(alphabet[usize::from(a >> 2)] as char);
        output.push(alphabet[usize::from((a & 3) << 4 | b >> 4)] as char);
        output.push(if group.len() > 1 {
            alphabet[usize::from((b & 15) << 2 | c >> 6)] as char
        } else {
            '='
        });
        output.push(if group.len() > 2 {
            alphabet[usize::from(c & 63)] as char
        } else {
            '='
        });
    }
    Some(output)
}

pub(super) fn remove_with_icon(store: &Store, fs: &impl IconFs, id: &str) -> Result<(), String> {
    let settings = store.local_settings()?;
    let icon = settings
        .local_apps
        .iter()
        .find(|app| app.id == id)
        .and_then(|app| app.icon.as_deref());
    let unshared = icon.filter(|icon| {
        !settings
            .local_apps
            .iter()
            .any(|other| other.id != id && other.icon.as_deref() == Some(*icon))
    });
    super::remove(store, id)?;
    if let Err(error) = delete_owned(fs, unshared) {
        eprintln!("could not clean up removed local icon: {error}");
    }
    Ok(())
}

#[cfg(test)]
#[path = "icons_tests.rs"]
mod tests;
