use tauri::image::Image;

// Pixel-aligned version of design/nexo-logo/tray.svg. The red face is readable
// on both light and dark taskbars, even where the dark relief blends in.
fn glyph(x: usize, y: usize) -> bool {
    let frame = (2..14).contains(&x)
        && (2..14).contains(&y)
        && (!(4..12).contains(&x) || !(4..12).contains(&y));
    let module_x = (5..7).contains(&x) || (9..11).contains(&x);
    let module_y = (5..7).contains(&y) || (9..11).contains(&y);
    frame || (module_x && module_y)
}

pub(crate) fn icon() -> Image<'static> {
    // Keep the 16 px grid exact at 32 px; Windows scales it for other DPIs.
    let mut rgba = Vec::with_capacity(32 * 32 * 4);
    for y in 0..32 {
        for x in 0..32 {
            let (x, y) = (x / 2, y / 2);
            let pixel = if glyph(x, y) {
                [0xE9, 0x1B, 0x35, 0xFF]
            } else if y > 0 && glyph(x, y - 1) {
                [0x80, 0x0C, 0x1D, 0xFF]
            } else {
                [0, 0, 0, 0]
            };
            rgba.extend_from_slice(&pixel);
        }
    }
    Image::new_owned(rgba, 32, 32)
}

#[cfg(test)]
mod tests {
    use super::icon;

    #[test]
    fn tray_icon_matches_the_pixel_aligned_artboard() {
        let expected = [
            "................",
            "................",
            "..RRRRRRRRRRRR..",
            "..RRRRRRRRRRRR..",
            "..RRSSSSSSSSRR..",
            "..RR.RR..RR.RR..",
            "..RR.RR..RR.RR..",
            "..RR.SS..SS.RR..",
            "..RR........RR..",
            "..RR.RR..RR.RR..",
            "..RR.RR..RR.RR..",
            "..RR.SS..SS.RR..",
            "..RRRRRRRRRRRR..",
            "..RRRRRRRRRRRR..",
            "..SSSSSSSSSSSS..",
            "................",
        ];
        let image = icon();
        assert_eq!((image.width(), image.height()), (32, 32));
        assert_eq!(image.rgba().len(), 32 * 32 * 4);
        for y in 0..32 {
            for x in 0..32 {
                let expected_pixel = match expected[y / 2].as_bytes()[x / 2] {
                    b'R' => [0xE9, 0x1B, 0x35, 0xFF],
                    b'S' => [0x80, 0x0C, 0x1D, 0xFF],
                    _ => [0, 0, 0, 0],
                };
                let offset = (y * 32 + x) * 4;
                assert_eq!(
                    &image.rgba()[offset..offset + 4],
                    &expected_pixel,
                    "{x},{y}"
                );
            }
        }
    }
}
